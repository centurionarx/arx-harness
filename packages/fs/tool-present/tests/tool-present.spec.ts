import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@arx-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentLoop from '@arx-ai/arx-agent-loop'
import { mountAgentLoopTestDependencies } from '@arx-ai/arx-agent-loop-testkit'
import { LocalFileSystem } from '@arx-ai/arx-fs-local'
import { FsVersion } from '@arx-ai/arx-fs'
import { CallId } from '@arx-ai/arx-llm'
import { SessionId, type Session, type SessionEvent } from '@arx-ai/arx-session'
import type { Agent } from '@arx-ai/arx-agent'
import * as Present from '../src/index.ts'

let root: string
let ctx: Context
let owner: Agent
let mounted: ReturnType<Context['plugin']>
let count = 0

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'arx-present-'))
  ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  mounted = ctx.plugin(Present)
  await mounted
  owner = ctx.agentLoop.create(SessionId('present-owner'), {}, { cwd: root })
  owner.session.append('turn/start', { turn: 1 })
  await writeFile(join(root, 'report.txt'), 'existing content')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

function call(files: unknown, agent: Agent | undefined = owner, signal = new AbortController().signal, id?: string) {
  return ctx.tools.execute({
    name: 'present', callId: CallId(id ?? `present-${++count}`), arguments: { files }, agent, signal,
  })
}

function deliveries(agent = owner) {
  return agent.session.events.filter(event => event.type === 'deliverables/presented')
}

function text(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

async function configure(config: Partial<Present.Config>) {
  await mounted.dispose()
  mounted = ctx.plugin(Present, { maxFiles: 8, maxMetadataBytes: 16384, ...config })
  await mounted
}

describe('present files through the owning filesystem', () => {
  it('records relative binary and text references only in the owning turn and leaves source bytes unchanged', async () => {
    await writeFile(join(root, 'chart.bin'), Buffer.from([0, 255, 10]))
    const files = [{ path: 'report.txt', description: 'Report' }, { path: 'chart.bin' }]
    const outcome = await call(files, owner, undefined, 'valid')
    expect(outcome.isError).toBe(false)
    expect(outcome.value).toEqual({ turn: 1, files })
    expect(text(outcome)).toMatchInlineSnapshot(`
      "Validated file for delivery: report.txt
      Validated file for delivery: chart.bin
      Current file contents are not copied or preserved."
    `)
    expect(deliveries().map(event => event.data)).toEqual([{ turn: 1, callId: 'valid', files }])
    expect(await readFile(join(root, 'chart.bin'))).toEqual(Buffer.from([0, 255, 10]))
    expect(await readFile(join(root, 'report.txt'), 'utf8')).toBe('existing content')
  })

  it.each([
    [[], 'accepts 1 to'],
    [[{ path: '' }], 'non-empty file path'],
    [[{ path: '   ' }], 'non-empty file path'],
    [[{ path: 'missing.txt' }], 'file not found'],
    [[{ path: '.' }], 'not a regular file'],
    [[{ path: 'report.txt' }, { path: 'missing.txt' }], 'file not found'],
    [[{ path: 42 }], 'string'],
  ])('rejects invalid or incomplete deliveries without an event', async (files, message) => {
    const result = await call(files)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(message)
    expect(deliveries()).toEqual([])
  })

  it('rejects a final symlink before resolving its target', async () => {
    vi.spyOn(ctx.fs, 'lstat').mockResolvedValue({ type: 'symlink', version: FsVersion('link') })
    const resolve = vi.spyOn(ctx.fs, 'resolve')
    expect((await call([{ path: 'link.txt' }])).isError).toBe(true)
    expect(resolve).not.toHaveBeenCalled()
    expect(deliveries()).toEqual([])
  })

  it.each([undefined, { type: 'directory' as const, version: FsVersion('directory') }])(
    'rejects a missing or non-file target after path inspection', async (info) => {
      vi.spyOn(ctx.fs, 'stat').mockResolvedValue(info)
      expect((await call([{ path: 'report.txt' }])).isError).toBe(true)
      expect(deliveries()).toEqual([])
    },
  )

  it('propagates filesystem denial without bypassing the configured provider', async () => {
    vi.spyOn(ctx.fs, 'lstat').mockRejectedValue(new Error('provider denied access'))
    const result = await call([{ path: 'report.txt' }])
    expect(text(result)).toContain('provider denied access')
    expect(deliveries()).toEqual([])
  })

  it('requires an owner, working directory and an open turn', async () => {
    const noOwner = await ctx.tools.execute({
      name: 'present', callId: CallId('no-owner'), arguments: { files: [{ path: 'report.txt' }] },
      signal: new AbortController().signal,
    })
    expect(text(noOwner)).toContain('owning agent session')
    const noCwd = ctx.agentLoop.create(SessionId('no-cwd'))
    noCwd.session.append('turn/start', { turn: 1 })
    expect(text(await call([{ path: 'report.txt' }], noCwd))).toContain('working directory')
    owner.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(text(await call([{ path: 'report.txt' }]))).toContain('open turn')
    expect(deliveries()).toEqual([])
  })

  it('applies count limits before touching the filesystem', async () => {
    await configure({ maxFiles: 1 })
    const inspect = vi.spyOn(ctx.fs, 'lstat')
    expect((await call([{ path: 'report.txt' }, { path: 'report.txt' }])).isError).toBe(true)
    expect(inspect).not.toHaveBeenCalled()
    expect(deliveries()).toEqual([])
  })

  it('bounds the complete UTF-8 payload including call identity and multibyte descriptions', async () => {
    const files = [{ path: 'report.txt', description: 'ação 😀' }]
    const cap = Buffer.byteLength(JSON.stringify({ turn: 1, callId: 'bound', files }), 'utf8')
    await configure({ maxMetadataBytes: cap })
    expect((await call(files, owner, undefined, 'bound')).isError).toBe(false)
    expect(deliveries()).toHaveLength(1)
    await configure({ maxMetadataBytes: cap - 1 })
    expect((await call(files, owner, undefined, 'bound')).isError).toBe(true)
    expect(deliveries()).toHaveLength(1)
  })

  it('publishes nothing when cancelled during metadata validation', async () => {
    const abort = new AbortController()
    const stat = ctx.fs.stat.bind(ctx.fs)
    vi.spyOn(ctx.fs, 'stat').mockImplementation(async (...args) => {
      const value = await stat(...args)
      abort.abort(new Error('cancelled'))
      return value
    })
    expect((await call([{ path: 'report.txt' }], owner, abort.signal)).isError).toBe(true)
    expect(deliveries()).toEqual([])
  })

  it('rejects a turn that closes while metadata is being checked', async () => {
    const stat = ctx.fs.stat.bind(ctx.fs)
    vi.spyOn(ctx.fs, 'stat').mockImplementation(async (...args) => {
      const value = await stat(...args)
      owner.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      return value
    })
    expect(text(await call([{ path: 'report.txt' }]))).toContain('original turn')
    expect(deliveries()).toEqual([])
  })

  it('does not publish a delivery rejected by post-execute policy', async () => {
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      await next()
      return { kind: 'block', feedback: [{ type: 'text', text: 'delivery rejected' }] }
    })
    const result = await call([{ path: 'report.txt' }])
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('delivery rejected')
    expect(deliveries()).toEqual([])
  })

  it('does not attribute a delayed success to the next turn', async () => {
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      const decision = await next()
      owner.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      owner.session.append('turn/start', { turn: 2 })
      return decision
    })
    expect((await call([{ path: 'report.txt' }])).isError).toBe(false)
    expect(deliveries()).toEqual([])
  })

  it('reports validation truthfully when the delivery append fails', async () => {
    ctx.on('internal/dispatch', (_mode, eventName, args) => {
      if (eventName !== 'session/event') return
      const [session, event] = args as [Session, SessionEvent]
      if (session === owner.session && event.type === 'deliverables/presented') {
        throw new Error('delivery storage unavailable')
      }
    }, { global: true })
    const result = await call([{ path: 'report.txt' }])
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Validated file for delivery')
    expect(text(result)).not.toContain('Presented')
    expect(deliveries()).toEqual([])
  })

  it('preserves source-relative references in a fork and isolates new sessions', async () => {
    await call([{ path: 'report.txt' }])
    owner.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const fork = ctx.sessions.fork(owner.session, undefined, SessionId('present-fork'))
    expect(fork.header.cwd).toBe(root)
    expect(fork.events.find(event => event.type === 'deliverables/presented')?.data.files)
      .toEqual([{ path: 'report.txt' }])
    const other = ctx.agentLoop.create(SessionId('other'), {}, { cwd: root })
    expect(deliveries(other)).toEqual([])
  })

  it('unregisters the tool and observer when its plugin unloads', async () => {
    await mounted.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'present')).toBe(false)
    expect((await call([{ path: 'report.txt' }])).isError).toBe(true)
    expect(deliveries()).toEqual([])
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe count configuration %s', async (maxFiles) => {
    await mounted.dispose()
    await expect(ctx.plugin(Present, { maxFiles, maxMetadataBytes: 16384 }).then(() => undefined)).rejects.toThrow('positive safe integer')
  })

  it('rejects unsafe byte configuration', async () => {
    await mounted.dispose()
    await expect(ctx.plugin(Present, { maxFiles: 8, maxMetadataBytes: 0 }).then(() => undefined)).rejects.toThrow('maxMetadataBytes')
  })
})

it('presents every original file path in the public tool call card', () => {
  expect(ctx.tools.get('present')?.presentCall?.({ files: [{ path: 'report.txt' }, { path: 'nested/chart.png' }] }))
    .toEqual({ card: 'generic', title: 'Present files', locations: [{ path: 'report.txt' }, { path: 'nested/chart.png' }] })
})
