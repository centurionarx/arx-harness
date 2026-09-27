/**
 * Web session model-directory and selection behavior: dynamic provider grouping,
 * provider-local catalog failures, logged-selection restoration without stale
 * catalog injection, advisory pass-through models, and the prompt-assembly
 * boundary for a running selection change.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import AgentRegistry, { agentEvents, loggedModelSelection } from '@arx-ai/arx-agent'
import type { Agent } from '@arx-ai/arx-agent'
import AttachmentStore from '@arx-ai/arx-attachment'
import LlmRuntime, { LlmAdapter, ReasoningEffortId } from '@arx-ai/arx-llm'
import type {
  GenerateOptions, LlmCallConfig, LlmModelInfo, LlmModelReasoningInfo, LlmProviderInfo,
  LlmResolvedModelInfo, StreamChunk,
  UserMessage,
} from '@arx-ai/arx-llm'
import SessionStore from '@arx-ai/arx-session'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@arx-ai/arx-session'
import SystemPrompt from '@arx-ai/arx-system-prompt'
import UserQuestionService from '@arx-ai/arx-user-questions'
import type { RpcRequest } from '@arx-ai/arx-host-apiproxy/api/rpc'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`models-${String(nextRpc++)}`), payload }
}

class CatalogAdapter extends LlmAdapter {
  constructor(
    private readonly name: string,
    private readonly models: readonly LlmModelInfo[] | Error,
    private readonly reasoning?: LlmModelReasoningInfo,
    private readonly exactError?: Error,
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.name }
  }

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return this.models instanceof Error
      ? Promise.reject(this.models)
      : Promise.resolve(this.models)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (this.exactError !== undefined) return Promise.reject(this.exactError)
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.reasoning === undefined ? {} : { reasoning: this.reasoning },
    })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Catalog tests never enter provider streaming.
  }
}

const REASONING: LlmModelReasoningInfo = {
  efforts: [
    { id: ReasoningEffortId('off'), name: 'Off' },
    { id: ReasoningEffortId('high'), name: 'High' },
    { id: ReasoningEffortId('max'), name: 'Max' },
  ],
  defaultEffort: ReasoningEffortId('high'),
}

async function harness(logged?: {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
}): Promise<{
  ctx: Context
  agent: Agent
  sessionId: SessionId
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  ctx.llm.registerAdapter(['deepseek-official'], new CatalogAdapter('DeepSeek', [
    { provider: 'deepseek-official', id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { provider: 'deepseek-official', id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', description: 'Reasoning model' },
  ], REASONING))
  ctx.llm.registerAdapter(['broken'], new CatalogAdapter('Broken Provider', new Error('catalog offline')))
  ctx.llm.registerAdapter(['metadata-broken'], new CatalogAdapter('Metadata Broken', [
    { provider: 'metadata-broken', id: 'listed', name: 'Listed' },
  ], undefined, new Error('reasoning metadata offline')))
  ctx.llm.registerAdapter(['empty'], new CatalogAdapter('Empty Provider', []))
  ctx.llm.registerAdapter(['duplicate'], new CatalogAdapter('Duplicate Provider', [
    { provider: 'duplicate', id: 'same', name: 'Same' },
    { provider: 'duplicate', id: 'same', name: 'Same Again' },
  ]))
  const session = ctx.sessions.create()
  if (logged !== undefined) {
    session.append('request/header', { header: { config: logged }, reason: 'initial' })
  }
  const agent = {
    id: session.id,
    session,
    status: 'running',
    ctx,
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  ctx.agents.register(agent)
  return { ctx, agent, sessionId: session.id }
}

/** Register a second bare live session/agent on an existing harness's ctx. */
function registerSession(ctx: Context): { agent: Agent; sessionId: SessionId } {
  // cwd matches every harness()'s `defaults.cwd` below: a cold-resolved
  // session (the restart describe block) is only ever found with one set.
  const session = ctx.sessions.create(undefined, { meta: { cwd: '/tmp' } })
  const agent = {
    id: session.id,
    session,
    status: 'running',
    ctx,
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  ctx.agents.register(agent)
  return { agent, sessionId: session.id }
}

function expectValue<T>(response: { result: { ok: true; value: T } | { ok: false } }): T {
  if (!response.result.ok) throw new Error('expected successful response')
  return response.result.value
}

function registerTextOnly(ctx: Context): void {
  ctx.llm.registerAdapter(['text-only'], new class extends CatalogAdapter {
    override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
    }
  }('Text Only', []))
}

describe('Web session model selection', () => {
  it('validates an ordered image batch before persisting any member', async () => {
    const { ctx, agent, sessionId } = await harness()
    const validateImage = vi.fn((_input: { data: Uint8Array }) => Promise.resolve())
    const saveImage = vi.fn((input: { data: Uint8Array; mediaType: 'image/png'; name?: string }) => Promise.resolve({
      attachmentId: `att-${String(input.data[0])}`,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...input.name === undefined ? {} : { name: input.name },
    }))
    const attachments = {
      imageLimits: {
        maxImageBytes: 4,
        maxImagesPerMessage: 2,
        maxMessageImageBytes: 4,
        maxImagePixels: 4,
        maxImageDimension: 2000,
        mediaTypes: ['image/png'],
      },
      validateImage,
      saveImage,
    }
    ctx.provide('attachments', Object.setPrototypeOf(attachments, AttachmentStore.prototype) as never)
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==', name: 'first.png' },
        { type: 'text' as const, text: 'compare' },
        { type: 'image' as const, mediaType: 'image/png' as const, data: 'Ag==' },
      ],
    }))
    expect(result.result.ok).toBe(true)
    expect(validateImage.mock.calls.map(([input]) => [...input.data])).toEqual([[1], [2]])
    expect(saveImage.mock.calls.map(([input]) => [...input.data])).toEqual([[1], [2]])
    expect((followup.mock.calls[0]?.[0] as UserMessage).content).toEqual([
      {
        type: 'image',
        attachment: {
          attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'first.png',
        },
      },
      { type: 'text', text: 'compare' },
      { type: 'image', attachment: { attachmentId: 'att-2', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
    ])

    const denied = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: Array.from({ length: 3 }, () => ({
        type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==',
      })),
    }))
    expect(denied.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'TOO_MANY_IMAGES' } },
    })
    expect(saveImage).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('allows a text-only selection while durable or pending images remain available for later models', async () => {
    const { ctx, agent, sessionId } = await harness()
    registerTextOnly(ctx)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })
    const image = {
      type: 'image' as const,
      attachment: { attachmentId: 'att-history', mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 },
    }
    agent.session.append('user/message', {
      id: 'image-message', role: 'user', source: { kind: 'user' }, content: [image],
    } as never, { surfaceOp: 'append' })
    expect(expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'text-only', model: 'plain',
    }))).selected).toEqual({ provider: 'text-only', model: 'plain' })

    agent.session.append('user/message', {
      id: 'summary', role: 'user', source: { kind: 'plugin', plugin: 'compact' },
      content: [{ type: 'text', text: 'image summarized' }],
    } as never, {
      // Replaces the sole prior surface node (the image message at seq 0) by
      // its own seq rather than the log's current length: an accepted pick
      // logs its own non-surface `model/selection` event in between, which
      // must not shift which surface node this replace targets.
      surfaceOp: { op: 'replace', start: 0, end: 0 },
      sourceEventSeqs: [0],
    })
    ;(agent.inbox.nextTurn as UserMessage[]).push({
      id: 'pending-image', role: 'user', source: { kind: 'user' }, content: [image],
    } as never)
    expect(expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'text-only', model: 'plain',
    }))).selected).toEqual({ provider: 'text-only', model: 'plain' })
    await ctx.fiber.dispose()
  })

  it('authorizes attachment bytes only when the session event stream references the id', async () => {
    const { ctx, agent, sessionId } = await harness()
    const ref = {
      attachmentId: 'att-authorized', mediaType: 'image/png' as const, bytes: 2, width: 1, height: 1,
    }
    const readImage = vi.fn(() => Promise.resolve({ ref, data: Uint8Array.of(1, 2) }))
    ctx.provide('attachments', { readImage } as never)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })
    agent.session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [{
        id: 'queued-image', role: 'user', source: { kind: 'user' },
        content: [{ type: 'image', attachment: ref }],
      }],
    } as never)

    const allowed = await api.sessions.attachment(request({
      sessionId, attachmentId: 'att-authorized' as never,
    }))
    expect(allowed.result).toMatchObject({ ok: true, value: { attachment: ref, data: 'AQI=' } })
    const denied = await api.sessions.attachment(request({
      sessionId, attachmentId: 'att-other' as never,
    }))
    expect(denied.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'ATTACHMENT_NOT_REFERENCED' } },
    })
    expect(readImage).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })
  it('groups successful providers and leaves an unlisted current selection out of the catalog', async () => {
    const { ctx, sessionId } = await harness({
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: ReasoningEffortId('max'),
    })
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }), cwd: '/tmp' })

    const catalog = expectValue(await api.sessions.models(request({ sessionId })))
    expect(catalog.current).toEqual({
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'max',
    })
    expect(catalog.groups).toEqual([{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: REASONING },
        {
          id: 'deepseek-reasoner',
          name: 'DeepSeek Reasoner',
          description: 'Reasoning model',
          reasoning: REASONING,
        },
      ],
    }])
    expect(catalog.failures).toEqual([
      { id: 'broken', name: 'Broken Provider', message: 'catalog offline' },
      { id: 'metadata-broken', name: 'Metadata Broken', message: 'reasoning metadata offline' },
      {
        id: 'duplicate',
        name: 'Duplicate Provider',
        message: 'adapter returned invalid or duplicate model metadata for provider "duplicate"',
      },
    ])
    await ctx.fiber.dispose()
  })

  it('accepts an advisory-unlisted model, rejects an unavailable provider, and switches only after the next assembly', async () => {
    const { ctx, agent, sessionId } = await harness()
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }), cwd: '/tmp' })
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed', temperature: 0.2 }
    const signal = new AbortController().signal

    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    expect((await ctx.systemPrompt.assemble()).variables)
      .toMatchObject({ provider: 'deepseek-official', model: 'deepseek-chat' })

    const selected = expectValue(await api.sessions.selectModel(request({
      sessionId,
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'max',
    })))
    expect(selected.selected).toEqual({
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'max',
    })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toMatchObject({ provider: 'deepseek-official', model: 'deepseek-chat' })

    expect((await ctx.systemPrompt.assemble()).variables)
      .toMatchObject({ provider: 'deepseek-official', model: 'private-preview' })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toMatchObject({
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'max',
    })

    const unsupported = await api.sessions.selectModel(request({
      sessionId,
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'medium',
    }))
    expect(unsupported.result).toMatchObject({
      ok: false,
      error: {
        code: 'model-unavailable',
        message: 'provider "deepseek-official" model "private-preview" does not support reasoning effort "medium"',
      },
    })

    const rejected = await api.sessions.selectModel(request({
      sessionId,
      provider: 'missing',
      model: 'model',
    }))
    expect(rejected.result).toEqual({
      ok: false,
      error: {
        code: 'model-unavailable',
        message: 'no adapter registered for provider "missing"',
        details: { provider: 'missing', model: 'model' },
      },
    })
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'private-preview', reasoningEffort: 'max' })
    await ctx.fiber.dispose()
  })

  it('reads the Agent default live for a session whose log names no selection', async () => {
    const { ctx, sessionId } = await harness()
    let stored = { provider: 'deepseek-official', model: 'deepseek-chat' }
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => stored,
      cwd: '/tmp',
    })

    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    // The default moving after the session exists still reaches it: New
    // Session reuses a blank session rather than minting another, so a seed
    // captured at creation would show the superseded model there.
    stored = { provider: 'deepseek-official', model: 'deepseek-reasoner' }
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-reasoner' })
    expect(expectValue(await api.host.describe(request({}))))
      .toMatchObject({ provider: 'deepseek-official', model: 'deepseek-reasoner' })
    await ctx.fiber.dispose()
  })

  it('keeps a session on its logged selection when the Agent default differs', async () => {
    const { ctx, sessionId } = await harness({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    })
    let stored = { provider: 'deepseek-official', model: 'deepseek-chat' }
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => stored,
      cwd: '/tmp',
    })

    stored = { provider: 'duplicate', model: 'same' }
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    await ctx.fiber.dispose()
  })

  it('keeps each session on its own pick, and the shared default follows the last accepted one', async () => {
    const { ctx, sessionId: sessionA } = await harness()
    const { sessionId: sessionB } = registerSession(ctx)
    let stored = { provider: 'deepseek-official', model: 'deepseek-chat' }
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => stored,
      saveDefaultModelSelection: (selection) => { stored = selection; return Promise.resolve() },
      cwd: '/tmp',
    })

    expectValue(await api.sessions.selectModel(request({
      sessionId: sessionA, provider: 'deepseek-official', model: 'deepseek-reasoner',
    })))
    expectValue(await api.sessions.selectModel(request({
      sessionId: sessionB, provider: 'duplicate', model: 'same',
    })))

    // Picking a different model in B never moved A's own selection.
    expect(expectValue(await api.sessions.models(request({ sessionId: sessionA }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-reasoner', reasoningEffort: 'high' })
    expect(expectValue(await api.sessions.models(request({ sessionId: sessionB }))).current)
      .toEqual({ provider: 'duplicate', model: 'same' })
    // The shared default (what a NEW session seeds from) equals the last
    // accepted pick from either session, not a fixed "session A's" value.
    expect(stored).toEqual({ provider: 'duplicate', model: 'same' })
    await ctx.fiber.dispose()
  })

  it('appends exactly one model/selection event per accepted pick, none on rejection or an identical reselect', async () => {
    const { ctx, agent, sessionId } = await harness()
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })
    const picks = (): unknown[] => agent.session.events.filter(event => event.type === 'model/selection')

    expect(picks()).toHaveLength(0)
    expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-reasoner',
    })))
    expect(picks()).toHaveLength(1)

    // A rejected pick (no adapter for "missing") writes nothing.
    await api.sessions.selectModel(request({ sessionId, provider: 'missing', model: 'model' }))
    expect(picks()).toHaveLength(1)

    // Reselecting the SAME model already in force writes nothing further: a
    // blank session repeatedly re-confirmed in the picker must not grow its
    // artifact past the cold blank-probe's byte ceiling for no semantic
    // change (see DEFAULT_COLD_BLANK_PROBE_MAX_BYTES).
    expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-reasoner',
    })))
    expect(picks()).toHaveLength(1)

    // A genuinely different pick appends a second event.
    expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-chat',
    })))
    expect(picks()).toHaveLength(2)
    await ctx.fiber.dispose()
  })

  it('logs a blank session\'s explicit pick of the default it was following, once', async () => {
    const { ctx, agent, sessionId } = await harness()
    let stored = { provider: 'deepseek-official', model: 'deepseek-chat' }
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => stored,
      saveDefaultModelSelection: (selection) => { stored = selection; return Promise.resolve() },
      cwd: '/tmp',
    })
    const picks = (): unknown[] => agent.session.events.flatMap(event => event.type === 'model/selection' ? [event.data] : [])
    const chat = { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' }

    expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-chat',
    })))
    expect(picks()).toEqual([chat])
    expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-chat',
    })))
    expect(picks()).toEqual([chat])

    // The log, which a later Agent for this session reads, keeps the pick
    // after another session moves the shared default.
    stored = { provider: 'duplicate', model: 'same' }
    expect(loggedModelSelection(agent.session)).toEqual(chat)
    await ctx.fiber.dispose()
  })

  it('is superseded by a later logged request, and then ignores default changes', async () => {
    // Both events pre-exist the Agent this test reads through (neither goes
    // through selectModel), so the first `.current` read has no in-process
    // pick to short-circuit its fold and genuinely exercises log order — an
    // in-process pick always stays authoritative for THIS Agent's remaining
    // lifetime once made (the "switches only after the next assembly" test
    // above), the same way a live pick already outranks any later default.
    const { ctx, agent, sessionId } = await harness()
    agent.session.append('model/selection', { provider: 'deepseek-official', model: 'deepseek-reasoner' })
    // A request actually sent under a third config (e.g. resolved by a
    // process that restarted between the pick and its first consumed step)
    // supersedes the unconsumed pick: the log order, not the event type,
    // decides which is effective.
    agent.session.append('request/header', {
      header: { config: { provider: 'duplicate', model: 'same' } },
      reason: 'initial',
    })
    let stored = { provider: 'deepseek-official', model: 'deepseek-chat' }
    const api = createApiProxy(ctx, { defaultModelSelection: () => stored, cwd: '/tmp' })

    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'duplicate', model: 'same' })

    // The superseding request also outranks a later default change, exactly
    // like an ordinary logged request already does.
    stored = { provider: 'empty', model: 'anything' }
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'duplicate', model: 'same' })
    await ctx.fiber.dispose()
  })

  it('saves an accepted selection as the default and survives a storage failure', async () => {
    const { ctx, sessionId } = await harness()
    const saved: unknown[] = []
    let reject = false
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      saveDefaultModelSelection: (selection) => {
        saved.push(selection)
        return reject ? Promise.reject(new Error('read-only document')) : Promise.resolve()
      },
      cwd: '/tmp',
    })

    expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-reasoner', reasoningEffort: 'max',
    })))
    expect(saved).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-reasoner', reasoningEffort: 'max' },
    ])

    // A refused selection never becomes anyone's default.
    await api.sessions.selectModel(request({ sessionId, provider: 'missing', model: 'model' }))
    expect(saved).toHaveLength(1)

    // Storage failing is not the selection failing: the switch already applies
    // to this session, so the call still succeeds.
    reject = true
    const stillAccepted = expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-chat',
    })))
    expect(stillAccepted.selected).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' })
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' })
    await ctx.fiber.dispose()
  })

  it('refuses a prompt no adapter can route, and reports it on the directory', async () => {
    const { ctx, sessionId } = await harness()
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deleted-gateway', model: 'deleted-model' }),
      cwd: '/tmp',
    })

    // The client disabling its input is an affordance; this method stays
    // callable, so the refusal has to live here.
    const refused = await api.sessions.prompt(request({
      sessionId, mode: 'queue' as const, content: [{ type: 'text' as const, text: 'hi' }],
    }))
    expect(refused.result).toMatchObject({
      ok: false,
      error: { code: 'model-unavailable', details: { provider: 'deleted-gateway', model: 'deleted-model' } },
    })
    expect(expectValue(await api.sessions.models(request({ sessionId }))).routable).toBe(false)

    // An advisory-unlisted model on a live route is NOT this: the route
    // serves it, so the prompt goes through and nothing blocks.
    expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'unlisted-but-served',
    })))
    const catalog = expectValue(await api.sessions.models(request({ sessionId })))
    expect(catalog.routable).toBe(true)
    expect(catalog.groups.flatMap(group => group.models.map(model => model.id)))
      .not.toContain('unlisted-but-served')
    await ctx.fiber.dispose()
  })

  it('serves a session and its catalog when the stored default names a route that is gone', async () => {
    const { ctx, sessionId } = await harness()
    const api = createApiProxy(ctx, {
      // What a Models-page removal leaves behind: the settings document still
      // names the route the user last picked, and nothing serves it.
      defaultModelSelection: () => ({ provider: 'deleted-gateway', model: 'deleted-model' }),
      cwd: '/tmp',
    })

    const catalog = expectValue(await api.sessions.models(request({ sessionId })))
    // Passed through rather than repaired: matching no group is precisely what
    // makes the composer seat prompt for a selection instead of naming a model
    // the deployment cannot reach.
    expect(catalog.current).toEqual({ provider: 'deleted-gateway', model: 'deleted-model' })
    expect(catalog.groups.flatMap(group => group.models.map(model => `${group.id}/${model.id}`)))
      .not.toContain('deleted-gateway/deleted-model')
    await ctx.fiber.dispose()
  })
})

/**
 * A restart loses every in-process WeakMap (the gateway's own `selections`
 * cache and `ctx.agents`' live registry alike): only what reached the session
 * log survives. Each boot below is an independent ApiProxy over a shared
 * plain-object store standing in for a real persistence backend — sufficient
 * to prove the cold-resume derivation reads the restored log, without
 * pulling a concrete agent-loop or on-disk backend into this package's tests.
 */
describe('session model selection survives an ApiProxy restart', () => {
  interface StoredSession { meta: SessionHeader; events: SessionEvent[] }

  /** Boot one ApiProxy generation over a shared store, resuming what an earlier generation left. */
  async function boot(store: Map<SessionId, StoredSession>): Promise<{ ctx: Context; api: ReturnType<typeof createApiProxy> }> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(AgentRegistry)
    ctx.llm.registerAdapter(['deepseek-official'], new CatalogAdapter('DeepSeek', [
      { provider: 'deepseek-official', id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { provider: 'deepseek-official', id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
    ]))
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([...store.values()].map(entry => entry.meta)),
      inspect: (id: SessionId) => {
        const entry = store.get(id)
        if (entry === undefined) throw new Error(`no stored session "${id}"`)
        return Promise.resolve({ meta: entry.meta, events: entry.events })
      },
      locate: () => undefined,
    } as never)
    ctx.agents.setFactory({
      createAgent: () => Promise.reject(new Error('this generation only resumes stored sessions')),
      resume: async (ownerCtx, options) => {
        const entry = store.get(options.resumeSessionId)
        if (entry === undefined) throw new Error(`no stored session "${options.resumeSessionId}"`)
        const session: Session = ctx.sessions.create(options.resumeSessionId, { seed: entry.events, meta: entry.meta })
        const agent = {} as Agent
        const agentCtx = ownerCtx.extend({ agent })
        Object.assign(agent, {
          id: session.id, session, status: 'idle', ctx: agentCtx, options: options.agentOptions ?? {},
        })
        await options.setup?.(agentCtx)
        ctx.agents.register(agent)
        return { agent, dispose: () => Promise.resolve() }
      },
    })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })
    return { ctx, api }
  }

  it("a blank session's pick survives a restart over the same store", async () => {
    const store = new Map<SessionId, StoredSession>()
    const before = await boot(store)
    const { sessionId } = registerSession(before.ctx)
    expectValue(await before.api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-reasoner',
    })))
    // Simulates the backend's own flush, which real persistence performs on
    // every append; this test's subject is the cold-resume derivation, not
    // the flush mechanism itself.
    const session = before.ctx.sessions.get(sessionId)
    if (session === undefined) throw new Error('unreachable')
    store.set(sessionId, { meta: session.header, events: [...session.events] })
    // Dispose the whole gateway fiber: SessionStore, AgentRegistry, and every
    // WeakMap `createApiProxy` closed over for this generation are all gone.
    await before.ctx.fiber.dispose()

    const after = await boot(store)
    expect(after.ctx.agents.get(sessionId)).toBeUndefined()
    expect(expectValue(await after.api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-reasoner' })
    await after.ctx.fiber.dispose()
  })
})
