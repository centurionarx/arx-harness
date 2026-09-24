import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import type { Agent } from '@arx-ai/arx-agent'
import AgentLoop from '@arx-ai/arx-agent-loop'
import { mountAgentLoopTestDependencies } from '@arx-ai/arx-agent-loop-testkit'
import { createUserMessage } from '@arx-ai/arx-llm'
import { SessionId } from '@arx-ai/arx-session'
import JsonlSessionPersistence from '@arx-ai/arx-session-persistence-jsonl'
import { ShellExecutor, type ShellExecRequest, type ShellExecSpec, type ShellProcess, type ShellRunResult } from '@arx-ai/arx-shell'
import { LocalBashExecutor } from '@arx-ai/arx-bash-local'
import LocalSubprocessRuntime from '@arx-ai/arx-subprocess-local'
import * as bridge from '../src/index.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function outcome(stdout = '', exitCode = 0): ShellRunResult {
  return { exitCode, signal: null, timedOut: false, aborted: false, timeoutMs: 1000,
    stdout: { text: stdout, truncated: false }, stderr: { text: '', truncated: false } }
}

/** Only the external command process is controlled; decoding and lifecycle dispatch stay real. */
class ControlledShell extends ShellExecutor {
  calls: ShellExecSpec[] = []
  execute: (spec: ShellExecSpec) => Promise<ShellRunResult> = async () => outcome()
  resolve(request: ShellExecRequest): ShellExecSpec {
    return { ...request, workdir: request.workdir ?? process.cwd(), timeoutMs: request.timeoutMs ?? 1000,
      stdoutMaxBytes: 65536, sandboxPolicy: undefined }
  }
  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    this.calls.push(spec)
    return this.execute(spec)
  }
  start(_spec: ShellExecSpec): ShellProcess { throw new Error('foreground hooks only') }
}

async function load(points: string[], config: Partial<bridge.Config> = {}, realShell = false) {
  const root = await mkdtemp(join(tmpdir(), 'arx-claude-code-lifecycle-'))
  roots.push(root)
  const configPath = join(root, 'hooks.json')
  await writeFile(configPath, JSON.stringify({ hooks: Object.fromEntries(points.map(point => [point, [
    { hooks: [{ type: 'command', command: realShell ? 'exit 2' : point }] },
  ]])) }))
  const yamlPath = join(root, 'cordis.yml')
  await writeFile(yamlPath, [
    '- name: test:dependencies',
    ...realShell ? ['- name: test:subprocess'] : [],
    '- name: test:shell',
    '- name: test:loop',
    '  config: { agents: [] }',
    '- name: test:bridge',
    '  config: ' + JSON.stringify({ configPath, ...config }),
    '',
  ].join('\n'))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test:dependencies', { name: 'test-dependencies', apply: mountAgentLoopTestDependencies }],
    ['test:shell', realShell ? LocalBashExecutor : ControlledShell],
    ['test:subprocess', LocalSubprocessRuntime],
    ['test:loop', AgentLoop],
    ['test:bridge', bridge],
  ])
  // The resolver supplies source modules; Include, schema validation, and activation use the real Loader.
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('unexpected Loader import: ' + specifier)
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(yamlPath).href } })
  await ctx.loader.await()
  const hooks = [...ctx.loader.entries()].find(entry => entry.options.name === 'test:bridge')?.fiber as Fiber
  expect(hooks).toBeDefined()
  const adapter = new MockAdapter(Array.from({ length: 32 }, () => textResponse('done')))
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, root, hooks, adapter, shell: ctx.shell as ControlledShell }
}

async function create(ctx: Context, id = 'agent') {
  return ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider: 'mock', model: 'mock' } })
}
function send(agent: Agent, text = 'go'): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}
function payload(spec: ShellExecSpec): { hook_event_name: string; stop_hook_active: boolean; session_id: string; source: string } {
  return JSON.parse(spec.stdin!) as ReturnType<typeof payload>
}
function startupOutput(): ShellRunResult {
  return outcome(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'startup guidance' } }))
}

function hold(shell: ControlledShell, point: string) {
  const started = Promise.withResolvers<ShellExecSpec>()
  const released = Promise.withResolvers<ShellRunResult>()
  const aborted = Promise.withResolvers<undefined>()
  shell.execute = async (spec) => {
    if (spec.command !== point) return outcome()
    started.resolve(spec)
    const onAbort = () => { aborted.resolve(undefined) }
    spec.signal!.addEventListener('abort', onAbort, { once: true })
    if (spec.signal!.aborted) onAbort()
    try { return await released.promise } finally { spec.signal!.removeEventListener('abort', onAbort) }
  }
  return { started: started.promise, aborted: aborted.promise, release: released.resolve }
}

describe('claude-code lifecycle through the real Loader and driver', () => {
  it.each([0, 1, 2, 8])('enforces maxStopContinuations=%s without hook self-limiting', async (limit) => {
    const { ctx, shell, adapter } = await load(['Stop'], { maxStopContinuations: limit })
    shell.execute = async () => outcome('', 2)
    const { agent } = await create(ctx)
    send(agent)
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(limit + 1)
    expect(shell.calls.map(call => payload(call).stop_hook_active)).toEqual([false, ...Array.from({ length: limit }, () => true)])
    expect(agent.session.events.filter(event => event.type === 'hook/result')).toHaveLength(limit + 1)
    expect(agent.session.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin')).toHaveLength(limit)
    expect(agent.session.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  })

  it('resets the cap on a new turn and isolates concurrent agents', async () => {
    const { ctx, shell, adapter } = await load(['Stop'], { maxStopContinuations: 1 })
    shell.execute = async () => outcome('', 2)
    const a = await create(ctx, 'a')
    const b = await create(ctx, 'b')
    send(a.agent); send(b.agent)
    await Promise.all([a.agent.whenIdle(), b.agent.whenIdle()])
    send(a.agent)
    await a.agent.whenIdle()
    expect(adapter.requests).toHaveLength(6)
    expect(shell.calls.filter(call => payload(call).session_id === 'a').map(call => payload(call).stop_hook_active)).toEqual([false, true, false, true])
    expect(shell.calls.filter(call => payload(call).session_id === 'b').map(call => payload(call).stop_hook_active)).toEqual([false, true])
  })

  it('honors a Stop hard halt before a simultaneous blocking decision', async () => {
    const { ctx, shell, adapter } = await load(['Stop'])
    shell.execute = async () => outcome('{"continue":false,"decision":"block","stopReason":"halt here"}')
    const { agent } = await create(ctx)
    send(agent); await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(agent.inbox.hasPending).toBe(false)
    expect(agent.session.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'hook', reason: 'halt here' } } } })
  })

  it('waits for delayed SessionStart and logs its context before the first request', async () => {
    const { ctx, shell, adapter } = await load(['SessionStart'])
    const pending = hold(shell, 'SessionStart')
    const { agent } = await create(ctx)
    expect(shell.calls).toHaveLength(0)
    send(agent)
    await pending.started
    expect(adapter.requests).toHaveLength(0)
    pending.release(startupOutput())
    await agent.whenIdle()
    expect(JSON.stringify(adapter.requests[0]!.messages)).toContain('startup guidance')
    const log = agent.session.events
    expect(log.filter(event => event.type === 'hook/invoked' || event.type === 'hook/result' || event.type === 'user/message').map(event => event.type))
      .toEqual(['hook/invoked', 'hook/result', 'user/message', 'user/message'])
    expect(log.find(event => event.type === 'user/message')).toMatchObject({ data: { source: { kind: 'plugin', plugin: 'hooks-claude-code' } } })
    send(agent, 'again'); await agent.whenIdle()
    expect(shell.calls).toHaveLength(1)
  })

  it('discards startup context with a downstream rejected claim without rerunning the hook', async () => {
    const { ctx, shell, adapter } = await load(['SessionStart'])
    shell.execute = async () => startupOutput()
    const reject = ctx.on('agent/pre-step', async () => ({ kind: 'reject' as const }))
    const { agent } = await create(ctx)
    send(agent); await agent.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'user/message')).toBe(false)
    reject()
    send(agent, 'next attempt'); await agent.whenIdle()
    expect(shell.calls).toHaveLength(1)
    expect(JSON.stringify(adapter.requests)).not.toContain('startup guidance')
  })

  it('discards startup context when the turn is cancelled during a downstream pre-step', async () => {
    const { ctx, shell, adapter } = await load(['SessionStart'])
    shell.execute = async () => startupOutput()
    const cancel = ctx.on('agent/pre-step', async ({ agent }, next) => {
      agent.cancel({ kind: 'user' })
      return next()
    })
    const { agent } = await create(ctx)
    send(agent); await agent.whenIdle()
    cancel()
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.some(event => event.type === 'user/message' && event.data.source.kind === 'plugin')).toBe(false)
    expect(agent.session.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
  })

  it('halts the first claimed turn on SessionStart continue:false', async () => {
    const { ctx, shell, adapter } = await load(['SessionStart'])
    shell.execute = async () => outcome('{"continue":false}')
    const { agent } = await create(ctx)
    send(agent); await agent.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    expect(agent.session.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'hook', reason: 'halted by SessionStart hook' } } } })
  })

  it.each(['SessionStart', 'Stop'])('cancellation drains %s and drops late output', async (point) => {
    const { ctx, shell, adapter } = await load([point])
    const pending = hold(shell, point)
    const { agent } = await create(ctx)
    send(agent)
    await pending.started
    agent.cancel({ kind: 'user' })
    await pending.aborted
    let idle = false
    const done = agent.whenIdle().then(() => { idle = true })
    await Promise.resolve()
    expect(idle).toBe(false)
    pending.release(point === 'Stop' ? outcome('', 2) : startupOutput())
    await done
    expect(agent.inbox.hasPending).toBe(false)
    expect(adapter.requests).toHaveLength(point === 'Stop' ? 1 : 0)
    expect(agent.session.events.filter(event => event.type === 'hook/result')).toHaveLength(1)
    expect(agent.session.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
  })

  it.each(['SessionStart', 'Stop'])('bridge disposal drains %s and unregisters interception', async (point) => {
    const { ctx, shell, hooks, adapter } = await load([point])
    const pending = hold(shell, point)
    const { agent } = await create(ctx)
    send(agent)
    await pending.started
    let disposed = false
    const done = hooks.dispose().then(() => { disposed = true })
    await pending.aborted
    expect(disposed).toBe(false)
    pending.release(point === 'Stop' ? outcome('', 2) : startupOutput())
    await done; await agent.whenIdle()
    expect(agent.inbox.hasPending).toBe(false)
    const before = adapter.requests.length
    send(agent); await agent.whenIdle()
    expect(adapter.requests).toHaveLength(before + 1)
    expect(shell.calls).toHaveLength(1)
  })

  it('agent disposal drains an eager detached startup without late injection', async () => {
    const { ctx, shell } = await load(['SessionStart'], { sessionStartMode: 'detached' })
    const pending = hold(shell, 'SessionStart')
    const handle = await create(ctx)
    await pending.started
    let disposed = false
    const done = handle.dispose().then(() => { disposed = true })
    await pending.aborted
    expect(disposed).toBe(false)
    pending.release(startupOutput())
    await done
    expect(handle.agent.inbox.hasPending).toBe(false)
    expect(ctx.agents.get(handle.agent.id)).toBeUndefined()
  })

  it('detached mode remains eager and cannot delay an already claimed request', async () => {
    const { ctx, shell, adapter } = await load(['SessionStart'], { sessionStartMode: 'detached' })
    const pending = hold(shell, 'SessionStart')
    const { agent } = await create(ctx)
    await pending.started
    send(agent); await agent.whenIdle()
    expect(JSON.stringify(adapter.requests)).not.toContain('startup guidance')
    pending.release(startupOutput())
    await vi.waitFor(() => { expect(agent.inbox.nextStep).toHaveLength(1) })
    send(agent); await agent.whenIdle()
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('startup guidance')
  })

  it('gates the first resumed turn even when its durable turn number exceeds one', async () => {
    const { ctx, shell, adapter, root } = await load(['SessionStart'])
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
    shell.execute = async () => outcome()
    const first = await create(ctx)
    send(first.agent); await first.agent.whenIdle()
    await first.dispose()
    const pending = hold(shell, 'SessionStart')
    const resumed = await ctx.agents.resume({ resumeSessionId: SessionId('agent'), agentOptions: { provider: 'mock', model: 'mock' } })
    send(resumed.agent)
    const call = await pending.started
    expect(payload(call).source).toBe('resume')
    expect(adapter.requests).toHaveLength(1)
    pending.release(startupOutput())
    await resumed.agent.whenIdle()
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('startup guidance')
    expect(resumed.agent.session.events.filter(event => event.type === 'hook/invoked').at(-1)).toMatchObject({ data: { turn: 2 } })
  })

  // POSIX shell scripts and process-group cancellation have no native Windows implementation.
  it.skipIf(process.platform === 'win32')('bounds an unconditional real POSIX command hook', async () => {
    const { ctx, adapter } = await load(['Stop'], { maxStopContinuations: 1 }, true)
    const { agent } = await create(ctx)
    send(agent); await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    expect(agent.session.events.filter(event => event.type === 'hook/result')).toHaveLength(2)
  })
})

describe('claude-code lifecycle configuration', () => {
  it('defaults to eight forced continuations and blocking startup', () => {
    expect(bridge.Config({ configPath: 'hooks.json' })).toMatchObject({ maxStopContinuations: 8, sessionStartMode: 'blocking' })
  })
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid continuation maximum %s before reading hooks.json', (maxStopContinuations) => {
    expect(() => { bridge.apply(new Context(), { configPath: 'missing.json', maxStopContinuations }) }).toThrow('maxStopContinuations must be a non-negative safe integer')
  })
  it('rejects an unknown startup mode through the config schema', () => {
    const config = JSON.parse('{"configPath":"hooks.json","sessionStartMode":"unknown"}') as bridge.Config
    expect(() => bridge.Config(config)).toThrow()
  })
})
