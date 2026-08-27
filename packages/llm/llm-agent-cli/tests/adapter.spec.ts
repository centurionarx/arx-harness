import { PassThrough } from 'node:stream'

import { Context } from '@arx-ai/cordis'
import LlmRuntime, { createUserMessage, LlmError, type Message, type StreamChunk } from '@arx-ai/arx-llm'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryMock = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => queryMock(...args) as unknown,
}))

const { AgentCliAdapter } = await import('../src/adapter.ts')
const plugin = await import('../src/index.ts')
const { resolveRoutes } = await import('../src/config.ts')

/** One vendor run whose messages the test supplies, pulled like the real one. */
function vendorRun(messages: readonly unknown[]): Record<string, unknown> {
  let index = 0
  return {
    next: () => Promise.resolve(index < messages.length
      ? { value: messages[index++], done: false }
      : { value: undefined, done: true }),
  }
}

/** A vendor run that spawns its CLI, as the real SDK does when it starts. */
function spawningRun(messages: readonly unknown[]): void {
  queryMock.mockImplementation((request: unknown) => {
    const options = (request as { options: Record<string, unknown> }).options
    void (options['spawnClaudeCodeProcess'] as (o: unknown) => unknown)({ command: '/c', args: [], cwd: '/workspace', env: {} })
    return vendorRun(messages)
  })
}

/** The content blocks one call opened its run with. */
async function delivered(call: number): Promise<unknown[]> {
  const prompt = (queryMock.mock.calls[call]?.[0] as { prompt: AsyncIterable<unknown> }).prompt
  const out: unknown[] = []
  for await (const message of prompt) out.push(message)
  return (out[0] as { message: { content: unknown[] } }).message.content
}

/** A spawn that records its request and hands back an inert handle. */
interface RecordingSpawn {
  calls: SubprocessSpawnSpec[]
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  terminated: () => number
}

function recordingSpawn(): RecordingSpawn {
  const calls: SubprocessSpawnSpec[] = []
  let terminations = 0
  return {
    calls,
    terminated: () => terminations,
    spawn: (spec) => {
      calls.push(spec)
      return {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        done: new Promise(() => {}),
        terminate: () => { terminations += 1 },
      } as unknown as SubprocessHandle
    },
  }
}

const ROUTES = {
  claude: {
    displayName: 'Claude',
    models: [
      { id: 'sonnet', contextWindow: 200_000, maxTokens: 8_192 },
      { id: 'opus', contextWindow: 200_000, acceptsImages: true },
    ],
  },
}

/** One image attachment reference, as a message content block carries it. */
const IMAGE = { type: 'image', attachment: { attachmentId: 'att-1' } } as never

/** An attachment store that answers one read with fixed bytes. */
function imageStore() {
  const reads: unknown[] = []
  return {
    reads,
    store: {
      readImageRequest: (ref: unknown, policy: unknown) => {
        reads.push({ ref, policy })
        return Promise.resolve({ mediaType: 'image/png', data: Uint8Array.of(9, 9) })
      },
    },
  }
}

/** Build one adapter over a fixed route table. */
function adapter(spawn = recordingSpawn().spawn, attachments?: unknown) {
  return new AgentCliAdapter({
    routes: () => resolveRoutes(ROUTES),
    spawn,
    cwd: () => '/workspace',
    attachments: () => attachments as never,
  })
}

const ask = createUserMessage({ content: [{ type: 'text', text: 'list files' }], source: { kind: 'user' } }) as Message

/** Drain one adapter stream. */
async function drain(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

beforeEach(() => { queryMock.mockReset() })

describe('route metadata', () => {
  it('names a configured route and falls back to its id', () => {
    expect(adapter().providerInfo('claude')).toEqual({ id: 'claude', name: 'Claude' })
    expect(adapter().providerInfo('absent')).toEqual({ id: 'absent', name: 'absent' })
  })

  it('lists configured models and nothing for an unknown route', async () => {
    await expect(adapter().listModels('claude')).resolves.toEqual([
      { provider: 'claude', id: 'sonnet', name: 'sonnet' },
      { provider: 'claude', id: 'opus', name: 'opus', inputModalities: ['text', 'image'] },
    ])
    await expect(adapter().listModels('absent')).resolves.toEqual([])
  })

  it('advertises the configured capacity, which compaction requires', async () => {
    await expect(adapter().resolveModel('claude', 'sonnet')).resolves.toEqual({
      provider: 'claude',
      id: 'sonnet',
      name: 'sonnet',
      context: { contextWindow: 200_000 },
      defaultMaxTokens: 8_192,
    })
  })

  it('fails naming an unconfigured route or model instead of guessing', () => {
    expect(() => adapter().resolveModel('absent', 'sonnet')).toThrow(LlmError)
    expect(() => adapter().resolveModel('claude', 'haiku')).toThrow(/serves no model/)
  })
})

describe('stream', () => {
  it('replaces the CLI agent loop with one model call', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success', session_id: 'vendor-1' }]))
    await drain(adapter().stream({
      provider: 'claude',
      model: 'sonnet',
      messages: [ask],
      system: 'harness prompt',
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object' } }],
    }))
    const options = (queryMock.mock.calls[0]?.[0] as { options: Record<string, unknown> }).options
    expect(options['systemPrompt']).toBe('harness prompt')
    expect(options['includePartialMessages']).toBe(true)
    expect(options['persistSession']).toBe(false)
    expect(options['allowedTools']).toEqual(['mcp__arx__bash'])
    expect(options['disallowedTools']).toContain('Bash')
    expect(options['disallowedTools']).toContain('Skill')
    expect(options['disallowedTools']).toContain('ToolSearch')
    // Omitting `skills` would leave the CLI's own defaults in force, so the
    // host's skill directories would reach the model unlogged.
    expect(options['skills']).toEqual([])
    // The vendor's own turn cap makes reaching it an error result, and its
    // resume needs a persisted session this route deliberately does not write.
    expect(options['maxTurns']).toBeUndefined()
    expect(options['resume']).toBeUndefined()
    await expect((options['canUseTool'] as () => Promise<{ behavior: string }>)())
      .resolves.toMatchObject({ behavior: 'deny' })
  })

  it('spawns the CLI through the harness process owner', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success' }]))
    const spawn = recordingSpawn()
    await drain(adapter(spawn.spawn).stream({ provider: 'claude', model: 'sonnet', messages: [ask] }))
    const options = (queryMock.mock.calls[0]?.[0] as { options: Record<string, unknown> }).options
    void (options['spawnClaudeCodeProcess'] as (o: unknown) => unknown)({ command: '/sdk/claude', args: ['--x'], cwd: '/workspace', env: {} })
    expect(spawn.calls[0]?.argv).toEqual(['/sdk/claude', '--x'])
    expect(spawn.calls[0]?.graceMs).toBe(3_000)
  })

  it('opens a run with the history it must know', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success' }]))
    await drain(adapter().stream({ provider: 'claude', model: 'sonnet', messages: [ask] }))
    expect(await delivered(0)).toEqual([{ type: 'text', text: 'user: list files' }])
  })

  it('opens its own run per call, replaying what came before', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success' }]))
    const sessionId = 'session-1' as never
    const one = adapter()
    await drain(one.stream({ provider: 'claude', model: 'sonnet', messages: [ask], sessionId }))
    const next = createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }) as Message
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success' }]))
    await drain(one.stream({ provider: 'claude', model: 'sonnet', messages: [ask, next], sessionId }))
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(await delivered(1)).toEqual([{ type: 'text', text: 'user: list files\n\nuser: again' }])
  })

  it('releases the run when the caller cancels mid-turn', async () => {
    const spawn = recordingSpawn()
    // A run that answers only once aborted, as the real one does — which is
    // the only moment this signal is meant to reach.
    queryMock.mockImplementation((request: unknown) => {
      const options = (request as { options: Record<string, unknown> }).options
      void (options['spawnClaudeCodeProcess'] as (o: unknown) => unknown)({ command: '/c', args: [], cwd: '/workspace', env: {} })
      const { signal } = options['abortController'] as AbortController
      return {
        next: () => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        }),
      }
    })
    const controller = new AbortController()
    const pending = drain(adapter(spawn.spawn).stream({
      provider: 'claude',
      model: 'sonnet',
      messages: [ask],
      sessionId: 'session-3' as never,
      signal: controller.signal,
    }))
    await new Promise((resolve) => { setImmediate(resolve) })
    controller.abort()
    await expect(pending).rejects.toThrow('aborted')
    // Cancelling released the run; ending the turn must not release it twice.
    expect(spawn.terminated()).toBe(1)
  })

  it('releases the run a failed turn left behind', async () => {
    const spawn = recordingSpawn()
    spawningRun([])
    queryMock.mockImplementation((request: unknown) => {
      const options = (request as { options: Record<string, unknown> }).options
      void (options['spawnClaudeCodeProcess'] as (o: unknown) => unknown)({ command: '/c', args: [], cwd: '/workspace', env: {} })
      return { next: () => Promise.reject(new Error('vendor died')) }
    })
    const one = adapter(spawn.spawn)
    await expect(drain(one.stream({ provider: 'claude', model: 'sonnet', messages: [ask], sessionId: 'session-4' as never })))
      .rejects.toThrow('vendor died')
    expect(spawn.terminated()).toBe(1)
  })

  it('releases the run once the turn it opened is over', async () => {
    const spawn = recordingSpawn()
    spawningRun([{ type: 'result', subtype: 'success' }])
    const one = adapter(spawn.spawn)
    await drain(one.stream({ provider: 'claude', model: 'sonnet', messages: [ask], sessionId: 'session-5' as never }))
    expect(spawn.terminated()).toBe(1)
  })

  it('omits an output cap the route did not configure', async () => {
    const bare = new AgentCliAdapter({
      routes: () => resolveRoutes({ claude: { models: [{ id: 'sonnet', contextWindow: 1_000 }] } }),
      spawn: recordingSpawn().spawn,
      cwd: () => '/workspace',
      attachments: () => undefined,
    })
    await expect(bare.resolveModel('claude', 'sonnet')).resolves.not.toHaveProperty('defaultMaxTokens')
  })

  it('declares image input only for a model that configuration says accepts it', async () => {
    const one = adapter()
    await expect(one.resolveModel('claude', 'opus')).resolves.toMatchObject({ inputModalities: ['text', 'image'] })
    await expect(one.resolveModel('claude', 'sonnet')).resolves.not.toHaveProperty('inputModalities')
    const listed = await one.listModels('claude')
    expect(listed.map(model => (model as { inputModalities?: unknown }).inputModalities))
      .toEqual([undefined, ['text', 'image']])
  })

  it("carries an attached image as bytes, read under the vendor's own limits", async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success' }]))
    const attached = imageStore()
    const withImage: Message = { ...ask, content: [{ type: 'text', text: 'see' }, IMAGE] }
    await drain(adapter(recordingSpawn().spawn, attached.store)
      .stream({ provider: 'claude', model: 'opus', messages: [withImage] }))
    expect(attached.reads).toHaveLength(1)
    expect((attached.reads[0] as { policy: unknown }).policy).toEqual({ maxPixels: 1_150_000, maxBytes: 5_000_000 })
    expect(await delivered(0)).toEqual([
      { type: 'text', text: 'user: see' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'CQk=' } },
    ])
  })

  it('fails an image when the composition mounts no attachment store', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success' }]))
    const withImage: Message = { ...ask, content: [IMAGE] }
    await expect(drain(adapter().stream({ provider: 'claude', model: 'opus', messages: [withImage] })))
      .rejects.toThrow(/mounts no attachment store/)
  })

  it('reads nothing when a request carries no image', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success' }]))
    const attached = imageStore()
    await drain(adapter(recordingSpawn().spawn, attached.store)
      .stream({ provider: 'claude', model: 'sonnet', messages: [ask] }))
    expect(attached.reads).toHaveLength(0)
  })

  it('fails an unconfigured route before starting a run', async () => {
    await expect(adapter().stream({ provider: 'absent', model: 'sonnet', messages: [] })[Symbol.asyncIterator]().next())
      .rejects.toThrow(/is not configured/)
  })
})

describe('plugin', () => {
  it('holds no route until configuration names one', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ;(ctx as unknown as { subprocess: unknown }).subprocess = { spawn: () => ({}) }
    plugin.apply(ctx, {})
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('drives the configured workspace and process owner on a real call', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success', session_id: 'vendor-1' }]))
    const spawn = recordingSpawn()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ;(ctx as unknown as { subprocess: unknown }).subprocess = { spawn: spawn.spawn }
    plugin.apply(ctx, { providers: ROUTES, cwd: '/configured' })
    const prepared = await ctx.llm.prepareCall({ provider: 'claude', model: 'sonnet' })
    await drain(prepared.stream({ ...prepared.config, messages: [ask] }))
    const options = (queryMock.mock.calls[0]?.[0] as { options: Record<string, unknown> }).options
    expect(options['cwd']).toBe('/configured')
    void (options['spawnClaudeCodeProcess'] as (o: unknown) => unknown)({ command: '/c', args: [], cwd: '/configured', env: {} })
    expect(spawn.calls).toHaveLength(1)
  })

  it('runs where the harness process runs when configuration names no workspace', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success', session_id: 'vendor-1' }]))
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ;(ctx as unknown as { subprocess: unknown }).subprocess = { spawn: recordingSpawn().spawn }
    plugin.apply(ctx, { providers: ROUTES })
    const prepared = await ctx.llm.prepareCall({ provider: 'claude', model: 'sonnet' })
    await drain(prepared.stream({ ...prepared.config, messages: [ask] }))
    expect((queryMock.mock.calls[0]?.[0] as { options: Record<string, unknown> }).options['cwd']).toBe(process.cwd())
  })

  it('releases its routes when the plugin unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ;(ctx as unknown as { subprocess: unknown }).subprocess = { spawn: () => ({}) }
    const fork = await ctx.plugin({
      inject: ['llm'],
      apply: (inner: Context) => { plugin.apply(inner, { providers: ROUTES, cwd: '/workspace' }) },
    })
    expect(ctx.llm.listProviders()).toEqual([{ id: 'claude', name: 'Claude' }])
    await fork.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('hands the adapter whatever attachment store the composition mounted', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success' }]))
    const attached = imageStore()
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ;(ctx as unknown as { subprocess: unknown }).subprocess = { spawn: recordingSpawn().spawn }
    // `ctx.get` reads the service store, which a plain property never enters.
    ctx.provide('attachments', attached.store as never)
    plugin.apply(ctx, { providers: ROUTES, cwd: '/workspace' })
    const prepared = await ctx.llm.prepareCall({ provider: 'claude', model: 'opus' })
    const withImage: Message = { ...ask, content: [IMAGE] }
    await drain(prepared.stream({ ...prepared.config, messages: [withImage] }))
    expect(attached.reads).toHaveLength(1)
  })

  it('registers one route per configured provider', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ;(ctx as unknown as { subprocess: unknown }).subprocess = { spawn: () => ({}) }
    plugin.apply(ctx, { providers: ROUTES, cwd: '/workspace' })
    expect(ctx.llm.listProviders()).toEqual([{ id: 'claude', name: 'Claude' }])
  })
})
