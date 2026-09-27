import { describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import SystemPrompt from '@arx-ai/arx-system-prompt'
import SessionStore from '@arx-ai/arx-session'
import type { SessionEvent } from '@arx-ai/arx-session'
import {
  agentEvents,
  foldSessionModelSelection,
  installedModelSelection,
  installModelSelection,
  loggedModelSelection,
  modelSelectionEquals,
  type Agent,
  type ModelSelection,
  type ModelSelectionRef,
} from '../src/index.ts'
import { ReasoningEffortId, type LlmCallConfig } from '@arx-ai/arx-llm'

describe('installModelSelection()', () => {
  it('snapshots prompt variables and request routing together, then disposes both listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = { current: undefined, assembled: undefined }
    const dispose = installModelSelection(ctx, selection)
    const agent = {} as Agent
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed', temperature: 0.2 }
    const signal = new AbortController().signal

    expect((await ctx.systemPrompt.assemble()).variables).toEqual({})
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toBe(seed)

    selection.current = {
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('high'),
    }
    expect((await ctx.systemPrompt.assemble()).variables).toMatchObject({ provider: 'alpha', model: 'a1' })
    selection.current = { provider: 'beta', model: 'b1' }
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('high'),
      temperature: 0.2,
    })

    expect((await ctx.systemPrompt.assemble()).variables).toMatchObject({ provider: 'beta', model: 'b1' })
    const inherited: LlmCallConfig = {
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('max'),
      temperature: 0.2,
    }
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(inherited),
    )).resolves.toEqual({ provider: 'beta', model: 'b1', temperature: 0.2 })

    dispose()
    expect((await ctx.systemPrompt.assemble()).variables).toEqual({})
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 2, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toBe(seed)
    await ctx.fiber.dispose()
  })

  it('registers the installed selection for installedModelSelection(), until dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const agent = {} as Agent
    const agentCtx = ctx.extend({ agent })
    const selection: ModelSelectionRef = { current: undefined, assembled: undefined }

    expect(installedModelSelection(agent)).toBeUndefined()
    const dispose = installModelSelection(agentCtx, selection)
    expect(installedModelSelection(agent)).toBeUndefined()
    selection.current = { provider: 'alpha', model: 'a1' }
    expect(installedModelSelection(agent)).toEqual({ provider: 'alpha', model: 'a1' })

    dispose()
    expect(installedModelSelection(agent)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('leaves no live registration for an agent-less context', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = { current: { provider: 'alpha', model: 'a1' }, assembled: undefined }
    // No `agent` on this plain context (unlike the fixtures above): the
    // install still couples the two waterfalls, but has no agent identity to
    // key a live registration by.
    installModelSelection(ctx, selection)
    await ctx.fiber.dispose()
  })
})

describe('foldSessionModelSelection()', () => {
  const requestHeaderEvent = (seq: number, config: ModelSelection): SessionEvent<'request/header'> => ({
    type: 'request/header', seq, time: seq, data: { header: { config }, reason: 'initial' },
  })
  const modelSelectionEvent = (seq: number, data: ModelSelection): SessionEvent<'model/selection'> => ({
    type: 'model/selection', seq, time: seq, data,
  })

  it('is undefined over a log with neither event', () => {
    expect(foldSessionModelSelection([])).toBeUndefined()
  })

  it('a later model/selection supersedes an earlier request/header', () => {
    const events: SessionEvent[] = [
      requestHeaderEvent(0, { provider: 'p1', model: 'm1' }),
      modelSelectionEvent(1, { provider: 'p2', model: 'm2', reasoningEffort: ReasoningEffortId('high') }),
    ]
    expect(foldSessionModelSelection(events)).toEqual({
      provider: 'p2', model: 'm2', reasoningEffort: ReasoningEffortId('high'),
    })
  })

  it('a later request/header supersedes an earlier unconsumed model/selection', () => {
    const events: SessionEvent[] = [
      modelSelectionEvent(0, { provider: 'p1', model: 'm1' }),
      requestHeaderEvent(1, { provider: 'p2', model: 'm2' }),
    ]
    expect(foldSessionModelSelection(events)).toEqual({ provider: 'p2', model: 'm2' })
  })

  it('skips unrelated event types and continues from a prior folded state across calls', () => {
    const first = foldSessionModelSelection([modelSelectionEvent(0, { provider: 'p1', model: 'm1' })])
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
      { type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    expect(foldSessionModelSelection(events, first)).toEqual({ provider: 'p1', model: 'm1' })
  })
})

describe('loggedModelSelection()', () => {
  it('is undefined for a session with neither event, then folds a pick incrementally', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()

    expect(loggedModelSelection(session)).toBeUndefined()
    session.append('model/selection', { provider: 'p1', model: 'm1' })
    expect(loggedModelSelection(session)).toEqual({ provider: 'p1', model: 'm1' })

    // A later request/header supersedes the pick, and a stale read (nothing
    // new appended since) answers from cache rather than refolding.
    expect(loggedModelSelection(session)).toEqual({ provider: 'p1', model: 'm1' })
    session.append('request/header', { header: { config: { provider: 'p2', model: 'm2' } }, reason: 'change' })
    expect(loggedModelSelection(session)).toEqual({ provider: 'p2', model: 'm2' })

    // A later pick supersedes that request in turn.
    session.append('model/selection', {
      provider: 'p3', model: 'm3', reasoningEffort: ReasoningEffortId('max'),
    })
    expect(loggedModelSelection(session)).toEqual({
      provider: 'p3', model: 'm3', reasoningEffort: ReasoningEffortId('max'),
    })
    await ctx.fiber.dispose()
  })

  it('keys its cache by the Session object, so a distinct session folds independently', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const a = ctx.sessions.create()
    const b = ctx.sessions.create()
    a.append('model/selection', { provider: 'a-provider', model: 'a-model' })

    expect(loggedModelSelection(a)).toEqual({ provider: 'a-provider', model: 'a-model' })
    expect(loggedModelSelection(b)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

describe('modelSelectionEquals()', () => {
  it('treats two absent selections as equal and one absent as unequal', () => {
    expect(modelSelectionEquals(undefined, undefined)).toBe(true)
    expect(modelSelectionEquals({ provider: 'p', model: 'm' }, undefined)).toBe(false)
    expect(modelSelectionEquals(undefined, { provider: 'p', model: 'm' })).toBe(false)
  })

  it('compares provider, model, and reasoning effort field-wise', () => {
    const base: ModelSelection = { provider: 'p', model: 'm', reasoningEffort: ReasoningEffortId('high') }
    expect(modelSelectionEquals(base, { ...base })).toBe(true)
    expect(modelSelectionEquals(base, { ...base, provider: 'other' })).toBe(false)
    expect(modelSelectionEquals(base, { ...base, model: 'other' })).toBe(false)
    expect(modelSelectionEquals(base, { ...base, reasoningEffort: ReasoningEffortId('low') })).toBe(false)
    expect(modelSelectionEquals(base, { provider: 'p', model: 'm' })).toBe(false)
  })
})
