import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@arx-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AgentLoop from '@arx-ai/arx-agent-loop'
import { mountAgentLoopTestDependencies } from '@arx-ai/arx-agent-loop-testkit'
import { LocalFileSystem } from '@arx-ai/arx-fs-local'
import { FsVersion } from '@arx-ai/arx-fs'
import { SessionId } from '@arx-ai/arx-session'
import type { Agent } from '@arx-ai/arx-agent'
import FilePreviewService from '../src/index.ts'

let ctx: Context
let owner: Agent
let root: string
let workspace: string
let mounted: ReturnType<Context['plugin']>
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'arx-preview-'))
  workspace = join(root, 'workspace')
  await mkdir(workspace)
  ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalFileSystem, { cwd: workspace })
  mounted = ctx.plugin(FilePreviewService, { maxBytes: 256 })
  await mounted
  owner = ctx.agentLoop.create(SessionId('preview-owner'), {}, { cwd: workspace })
  await writeFile(join(workspace, 'report.md'), '# Current report')
})
afterEach(async () => { vi.restoreAllMocks(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
const read = (path: string, agent = owner, signal = new AbortController().signal) => ctx.filePreviews.read(agent, path, signal)

it('returns current JSON-only document bytes without creating transcript input or a persistent copy', async () => {
  const before = [...owner.session.events]
  expect(await read('report.md')).toEqual({ path: 'report.md', kind: 'markdown', mediaType: 'text/markdown',
    encoding: 'utf8', content: '# Current report', bytes: 16 })
  await writeFile(join(workspace, 'report.md'), '# Updated')
  expect((await read('report.md')).content).toBe('# Updated')
  expect(owner.session.events).toEqual(before)
})

it.each([
  ['page.html', 'html', 'text/html', '<h1>Page</h1>'],
  ['data.json', 'code', 'text/plain', '{"x":1}'],
  ['drawing.png', 'image', 'image/png', 'raster'],
  ['document.pdf', 'pdf', 'application/pdf', '%PDF-1.7'],
])('classifies only the allowlisted format %s', async (path, kind, mediaType, content) => {
  await writeFile(join(workspace, path), content)
  const result = await read(path)
  expect(result).toMatchObject({ kind, mediaType })
  expect(result.content).toBe(result.encoding === 'utf8' ? content : Buffer.from(content).toString('base64'))
  expect(JSON.parse(JSON.stringify(result))).toEqual(result)
})

it.each(['missing.md', '.', 'script.svg', 'program.exe', '../outside.md'])('refuses %s without reading bytes', async (path) => {
  await writeFile(join(root, 'outside.md'), 'private outside')
  const bytes = vi.spyOn(ctx.fs, 'readBytes')
  await expect(read(path)).rejects.toThrow()
  expect(bytes).not.toHaveBeenCalled()
})

it('rejects final symlinks and target aliases escaping the workspace before reading', async () => {
  const bytes = vi.spyOn(ctx.fs, 'readBytes')
  vi.spyOn(ctx.fs, 'lstat').mockResolvedValueOnce({ type: 'symlink', version: FsVersion('link') })
  await expect(read('report.md')).rejects.toThrow('regular file')
  vi.spyOn(ctx.fs, 'contains').mockReturnValueOnce(false)
  await expect(read('report.md')).rejects.toThrow('inside the session workspace')
  expect(bytes).not.toHaveBeenCalled()
})

it('passes the byte bound to the provider, which rejects oversized files before content reads', async () => {
  const bytes = vi.spyOn(ctx.fs, 'readBytes')
  await read('report.md')
  expect(bytes.mock.calls[0]?.[2]).toBe(256)
  await writeFile(join(workspace, 'large.txt'), 'x'.repeat(257))
  bytes.mockClear()
  await expect(read('large.txt')).rejects.toThrow('byte limit')
  expect(bytes).toHaveBeenCalledOnce()
})

it('contains invalid UTF-8 and binary text without returning file contents', async () => {
  await writeFile(join(workspace, 'invalid.txt'), Buffer.from([255, 254]))
  await writeFile(join(workspace, 'binary.txt'), 'hidden\0bytes')
  await expect(read('invalid.txt')).rejects.toThrow('valid UTF-8')
  await expect(read('binary.txt')).rejects.toThrow('Binary content')
})

it('uses the actual Agent-scoped provider even when the root provider could read the file', async () => {
  const scoped = owner.ctx.isolate('fs')
  await scoped.plugin(LocalFileSystem, { cwd: workspace })
  const scopedOwner = { ...owner, ctx: scoped } as Agent
  vi.spyOn(ctx.agents, 'get').mockReturnValue(scopedOwner)
  const rootRead = vi.spyOn(ctx.fs, 'readBytes')
  const scopedProvider = scoped.get('fs')
  if (scopedProvider === undefined) throw new Error('missing scoped test provider')
  const scopedRead = vi.spyOn(scopedProvider, 'readBytes').mockRejectedValue(new Error('scoped access denied'))
  await expect(read('report.md', scopedOwner)).rejects.toThrow('scoped access denied')
  expect(scopedRead).toHaveBeenCalledOnce()
  expect(rootRead).not.toHaveBeenCalled()
})

it('rejects unknown owners and absent working directories', async () => {
  vi.spyOn(ctx.agents, 'get').mockReturnValueOnce(undefined)
  await expect(read('report.md')).rejects.toThrow('unavailable for this session')
  const empty = ctx.agentLoop.create(SessionId('no-cwd'))
  await expect(read('report.md', empty)).rejects.toThrow('unavailable for this session')
})

it('does not publish a read cancelled or detached during its provider operation', async () => {
  const controller = new AbortController()
  vi.spyOn(ctx.fs, 'readBytes').mockImplementationOnce(async () => { controller.abort(); return Uint8Array.of(65) })
  await expect(read('report.md', owner, controller.signal)).rejects.toThrow()
  vi.spyOn(ctx.fs, 'readBytes').mockImplementationOnce(async () => {
    vi.spyOn(ctx.agents, 'get').mockReturnValue(undefined)
    return Uint8Array.of(65)
  })
  await expect(read('report.md')).rejects.toThrow('session changed')
})

it.each([0, -1, 1.5, 16777217])('rejects unsafe byte configuration %s', async (maxBytes) => {
  await mounted.dispose()
  await expect(ctx.plugin(FilePreviewService, { maxBytes }).then(() => undefined)).rejects.toThrow('maxBytes')
})

it('rejects non-string paths at the Remote boundary', async () => {
  await expect(read(42 as unknown as string)).rejects.toThrow('not supported')
})
it('enforces the bound even when a plain scoped provider violates its byte contract', async () => {
  const local = ctx.fs
  const provider = { resolve: local.resolve.bind(local), contains: local.contains.bind(local),
    lstat: local.lstat.bind(local), readBytes: async () => new Uint8Array(257) }
  const agent = { ...owner, ctx: { get: () => provider } } as unknown as Agent
  vi.spyOn(ctx.agents, 'get').mockReturnValue(agent)
  await expect(read('report.md', agent)).rejects.toThrow('preview byte limit')
})
it('uses the documented default bound when constructed without configuration', async () => {
  await mounted.dispose()
  const service = new FilePreviewService(ctx)
  expect((await service.read(owner, 'report.md', new AbortController().signal)).content).toBe('# Current report')
})
