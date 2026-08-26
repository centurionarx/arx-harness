import { PassThrough } from 'node:stream'

import { Context } from '@centurionarx/cordis'
import LlmRuntime, { createUserMessage, LlmError, type Message, type StreamChunk } from '@centurionarx/cxh-llm'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@centurionarx/cxh-subprocess'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryMock = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => queryMock(...args) as unknown,
}))

const { AgentCliAdapter } = await import('../src/adapter.ts')
const plugin = await import('../src/index.ts')
const { resolveRoutes } = await import('../src/config.ts')

/** One vendor run whose messages the test supplies. */
function vendorRun(messages: readonly unknown[]): Record<string, unknown> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const message of messages) yield message
    },
    interrupt: vi.fn(() => Promise.resolve()),
  }
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
  claude: { displayName: 'Claude', models: [{ id: 'sonnet', contextWindow: 200_000, maxTokens: 8_192 }] },
}

/** Build one adapter over a fixed route table. */
function adapter(spawn = recordingSpawn().spawn) {
  return new AgentCliAdapter({ routes: () => resolveRoutes(ROUTES), spawn, cwd: () => '/workspace' })
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
    await expect(adapter().listModels('claude')).resolves.toEqual([{ provider: 'claude', id: 'sonnet', name: 'sonnet' }])
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
    expect(() => adapter().resolveModel('claude', 'opus')).toThrow(/serves no model/)
  })
})

describe('stream', () => {
  it('replaces the CLI agent loop with one model call', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success', session_id: 'vendor-1' }]))
    const spawn = recordingSpawn()
    await drain(adapter(spawn.spawn).stream({
      provider: 'claude',
      model: 'sonnet',
      messages: [ask],
      system: 'harness prompt',
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object' } }],
    }))
    const options = (queryMock.mock.calls[0]?.[0] as { options: Record<string, unknown> }).options
    expect(options['maxTurns']).toBe(1)
    expect(options['systemPrompt']).toBe('harness prompt')
    expect(options['includePartialMessages']).toBe(true)
    expect(options['persistSession']).toBe(false)
    expect(options['allowedTools']).toEqual(['mcp__cxh__bash'])
    expect(options['disallowedTools']).toContain('Bash')
    // Omitting `skills` would leave the CLI's own defaults in force, so the
    // host's skill directories would reach the model unlogged.
    expect(options['skills']).toEqual([])
    expect(options['disallowedTools']).toContain('Skill')
    await expect((options['canUseTool'] as () => Promise<{ behavior: string }>)())
      .resolves.toMatchObject({ behavior: 'deny' })
  })

  it('spawns the CLI through the harness process owner and terminates its tree', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success', session_id: 'vendor-1' }]))
    const spawn = recordingSpawn()
    await drain(adapter(spawn.spawn).stream({ provider: 'claude', model: 'sonnet', messages: [ask] }))
    const options = (queryMock.mock.calls[0]?.[0] as { options: Record<string, unknown> }).options
    const spawned = options['spawnClaudeCodeProcess'] as (o: unknown) => unknown
    spawned({ command: '/sdk/claude', args: ['--x'], cwd: '/workspace', env: {} })
    expect(spawn.calls[0]?.argv).toEqual(['/sdk/claude', '--x'])
    expect(spawn.calls[0]?.graceMs).toBe(3_000)
  })

  it('replays the transcript when no vendor session can continue it', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success', session_id: 'vendor-1' }]))
    await drain(adapter().stream({ provider: 'claude', model: 'sonnet', messages: [ask] }))
    expect((queryMock.mock.calls[0]?.[0] as { prompt: unknown }).prompt).toBe('user: list files')
  })

  it('resumes with only the delta once the vendor session holds the prefix', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success', session_id: 'vendor-1' }]))
    const sessionId = 'session-1' as never
    const one = adapter()
    await drain(one.stream({ provider: 'claude', model: 'sonnet', messages: [ask], sessionId }))
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success', session_id: 'vendor-1' }]))
    const next = createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }) as Message
    await drain(one.stream({ provider: 'claude', model: 'sonnet', messages: [ask, next], sessionId }))
    const second = queryMock.mock.calls[1]?.[0] as { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }
    expect(second.options['resume']).toBe('vendor-1')
    const delivered: unknown[] = []
    for await (const message of second.prompt) delivered.push(message)
    expect(delivered).toEqual([{ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'again' }] }, parent_tool_use_id: null }])
  })

  it('forwards caller cancellation to the vendor run', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success', session_id: 'vendor-1' }]))
    const controller = new AbortController()
    await drain(adapter().stream({ provider: 'claude', model: 'sonnet', messages: [ask], signal: controller.signal }))
    const options = (queryMock.mock.calls[0]?.[0] as { options: { abortController: AbortController } }).options
    controller.abort()
    expect(options.abortController.signal.aborted).toBe(true)
  })

  it('omits an output cap the route did not configure', async () => {
    const bare = new AgentCliAdapter({
      routes: () => resolveRoutes({ claude: { models: [{ id: 'sonnet', contextWindow: 1_000 }] } }),
      spawn: recordingSpawn().spawn,
      cwd: () => '/workspace',
    })
    await expect(bare.resolveModel('claude', 'sonnet')).resolves.not.toHaveProperty('defaultMaxTokens')
  })

  it('keeps no affinity for a run the vendor never identified', async () => {
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success' }]))
    const sessionId = 'session-2' as never
    const one = adapter()
    await drain(one.stream({ provider: 'claude', model: 'sonnet', messages: [ask], sessionId }))
    queryMock.mockReturnValue(vendorRun([{ type: 'result', subtype: 'success' }]))
    await drain(one.stream({ provider: 'claude', model: 'sonnet', messages: [ask], sessionId }))
    expect((queryMock.mock.calls[1]?.[0] as { options: Record<string, unknown> }).options['resume']).toBeUndefined()
  })

  it('survives a vendor that refuses to shut its protocol down', async () => {
    const run = vendorRun([{ type: 'result', subtype: 'success', session_id: 'vendor-1' }])
    run['interrupt'] = () => Promise.reject(new Error('already gone'))
    queryMock.mockReturnValue(run)
    await expect(drain(adapter().stream({ provider: 'claude', model: 'sonnet', messages: [ask] })))
      .resolves.toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
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
    ;(options['spawnClaudeCodeProcess'] as (o: unknown) => unknown)({ command: '/c', args: [], cwd: '/configured', env: {} })
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

  it('registers one route per configured provider', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ;(ctx as unknown as { subprocess: unknown }).subprocess = { spawn: () => ({}) }
    plugin.apply(ctx, { providers: ROUTES, cwd: '/workspace' })
    expect(ctx.llm.listProviders()).toEqual([{ id: 'claude', name: 'Claude' }])
  })
})
