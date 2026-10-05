import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import * as LocalFS from '@arx-ai/arx-fs-local'
import * as SandboxFS from '@arx-ai/arx-fs-sandbox'
import * as Subprocess from '@arx-ai/arx-subprocess-local'
import * as SandboxPolicy from '@arx-ai/arx-sandbox-policy'
import * as Storage from '@arx-ai/arx-storage'
import * as StorageJson from '@arx-ai/arx-storage-json'
import * as Domain from '@arx-ai/arx-storage-domain'
import * as Sessions from '@arx-ai/arx-session'
import * as Persistence from '@arx-ai/arx-session-persistence-jsonl'
import * as Workspace from '@arx-ai/arx-workspace'
import { FileSystem } from '@arx-ai/arx-fs'
import { SubprocessRuntime } from '@arx-ai/arx-subprocess'
import type { SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Repository from '../src/index.ts'
import type { Config } from '../src/index.ts'
import { parsePorcelain } from '../src/porcelain.ts'

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})

async function harness(config: Config = {}, sandbox = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arx-repository-')))
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  const ctx = new Context()
  disposers.push(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const modules = new Map<string, unknown>([
    ['storage', Storage], ['json', StorageJson], ['domain', Domain], ['sessions', Sessions], ['persistence', Persistence],
    ['workspace', Workspace], ['fs', sandbox ? SandboxFS : LocalFS], ['subprocess', Subprocess], ['repository', Repository],
    ['policy', SandboxPolicy],
  ])
  const rows = [
    { name: 'storage' }, { name: 'json', config: { root: join(root, 'storage') } },
    { name: 'domain', config: { backend: 'json' } }, { name: 'sessions' },
    { name: 'persistence', config: { root: join(root, 'sessions'), compression: 'none' } }, { name: 'workspace' },
    ...(sandbox ? [{ name: 'policy', config: { mode: 'read-only', workspaceRoot: cwd } }] : []),
    { name: 'fs', config: { cwd } }, { name: 'subprocess' }, { name: 'repository', config },
  ]
  // JSON is YAML; the Loader owns plugin construction and injection for every real provider.
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify(rows))
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected import')
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => !entry.disabled && !entry.fiber)).toEqual([])
  const workspace = await ctx.workspaceRegistry.create(cwd)
  const signal = new AbortController().signal
  // Host configuration is nondeterministic; isolate file sources while retaining real Git parsing and execution.
  await writeFile(join(root, 'system.config'), '')
  const realSpawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(spec => realSpawn({ ...spec, env: { ...spec.env,
    HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: join(root, '.config'), GIT_CONFIG_SYSTEM: join(root, 'system.config'),
  } }))
  const git = async (...args: string[]) => {
    const executable = await ctx.subprocess.resolveExecutable('git')
    const handle = ctx.subprocess.spawn({ argv: [executable, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'core.hooksPath=' + join(root, 'absent-hooks'), ...args], cwd, graceMs: 100,
    env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'absent-config'), GIT_TERMINAL_PROMPT: '0' },
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 1024 * 1024 } } })
    const outcome = await handle.done
    const output = handle.collected.stdout?.readFrom(0)
    expect(output?.lossy).toBe(false)
    expect(outcome.signal).toBeNull()
    return { code: outcome.exitCode, text: output?.text ?? '' }
  }
  const ok = async (...args: string[]) => { const result = await git(...args); expect(result.code).toBe(0); return result.text }
  await ok('init', '--initial-branch=main')
  return { root, cwd, ctx, workspaceId: workspace.id, signal, git, ok,
    inspect: () => ctx.repository.inspect({ workspaceId: workspace.id }, signal),
    status: () => ctx.repository.status({ workspaceId: workspace.id }, signal),
    diff: (path: string, side: Repository.DiffSide) => ctx.repository.diff({ workspaceId: workspace.id, path, side }, signal),
  }
}

async function commit(h: Awaited<ReturnType<typeof harness>>, filename = 'same.txt') {
  await writeFile(join(h.cwd, filename), 'base\n')
  await h.ok('add', '--', filename)
  await h.ok('commit', '-m', 'base')
}

describe('host repository through real Loader, FS, registry and managed Git', () => {
  it('separates both sides of one path, retains odd names, and never writes the index during reads', async () => {
    const h = await harness()
    await commit(h)
    await writeFile(join(h.cwd, 'same.txt'), 'staged\n')
    await h.ok('add', '--', 'same.txt')
    await writeFile(join(h.cwd, 'same.txt'), 'unstaged\n')
    const odd = '- odd\tname\náéç.txt'
    await writeFile(join(h.cwd, odd), 'new\n')
    await writeFile(join(h.cwd, ':(glob)*'), 'literal\n')
    const before = await readFile(join(h.cwd, '.git/index'))
    const status = await h.status()
    expect(status.staged).toMatchObject([{ path: 'same.txt', xy: 'MM' }])
    expect(status.unstaged).toMatchObject([{ path: 'same.txt', xy: 'MM' }])
    expect(status.untracked.map(entry => entry.path)).toEqual(expect.arrayContaining([odd, ':(glob)*']))
    expect((await h.diff('same.txt', 'staged')).text).toContain('+staged')
    expect((await h.diff('same.txt', 'unstaged')).text).toContain('+unstaged')
    expect((await h.diff(odd, 'untracked')).text).toContain('+new')
    expect((await h.diff(':(glob)*', 'untracked')).text).toContain('+literal')
    expect(await readFile(join(h.cwd, '.git/index'))).toEqual(before)
    expect(h.ctx.get('agents')).toBeUndefined()
  })

  it('reports renames, deletes, binary files, unborn and detached heads', async () => {
    const h = await harness()
    expect(await h.inspect()).toMatchObject({ branch: 'main', head: null, aheadBehind: null })
    await commit(h)
    await h.ok('mv', 'same.txt', 'renamed.txt')
    expect((await h.status()).staged).toMatchObject([{ path: 'renamed.txt', originalPath: 'same.txt', xy: 'R.' }])
    expect((await h.diff('renamed.txt', 'staged')).text).toContain('+base')
    await h.ok('commit', '-m', 'rename')
    await rm(join(h.cwd, 'renamed.txt'))
    expect((await h.status()).unstaged).toMatchObject([{ path: 'renamed.txt', xy: '.D' }])
    expect((await h.diff('renamed.txt', 'unstaged')).text).toContain('-base')
    await writeFile(join(h.cwd, 'binary'), Buffer.from([0, 1, 2, 3]))
    expect(await h.diff('binary', 'untracked')).toMatchObject({ binary: true, text: '' })
    await h.ok('add', '--', 'binary')
    expect(await h.diff('binary', 'staged')).toMatchObject({ binary: true, text: '' })
    await h.ok('checkout', '--detach', 'HEAD')
    const detached = await h.inspect()
    expect(detached.branch).toBeNull()
    expect(detached.head).toMatch(/^[a-f0-9]{40}$/)
  })

  it('reports conflicts independently and refuses conflict previews', async () => {
    const h = await harness()
    await commit(h)
    await h.ok('checkout', '-b', 'other')
    await writeFile(join(h.cwd, 'same.txt'), 'other\n')
    await h.ok('commit', '-am', 'other')
    await h.ok('checkout', 'main')
    await writeFile(join(h.cwd, 'same.txt'), 'main\n')
    await h.ok('commit', '-am', 'main')
    expect((await h.git('merge', 'other')).code).toBe(1)
    expect((await h.status()).unmerged).toMatchObject([{ path: 'same.txt', xy: 'UU' }])
    await expect(h.diff('same.txt', 'unstaged')).rejects.toThrow('REPOSITORY_UNSUPPORTED_CONFLICT')
  })

  it('sanitizes credential URLs and uses only local upstream counters', async () => {
    const h = await harness()
    await commit(h)
    await h.ok('remote', 'add', 'origin', 'https://user:private-password@example.invalid/secret-path?token=private#secret')
    await h.ok('remote', 'add', 'ssh', 'user@example.invalid:private-path')
    await h.ok('remote', 'add', 'local', '/secret/local-path')
    await h.ok('update-ref', 'refs/remotes/origin/main', 'HEAD')
    await h.ok('config', 'branch.main.remote', 'origin')
    await h.ok('config', 'branch.main.merge', 'refs/heads/main')
    const inspection = await h.inspect()
    expect(inspection.aheadBehind).toEqual({ ahead: 0, behind: 0 })
    expect(inspection.remotes).toEqual([
      { name: 'origin', host: 'example.invalid', transport: 'https' },
      { name: 'ssh', host: 'example.invalid', transport: 'ssh' },
      { name: 'local', host: null, transport: null },
    ])
    expect(JSON.stringify(inspection)).not.toContain('private')
    await writeFile(join(h.cwd, 'same.txt'), 'ahead\n')
    await h.ok('commit', '-am', 'ahead')
    expect((await h.inspect()).aheadBehind).toEqual({ ahead: 1, behind: 0 })
  })

  it('refuses unknown workspace, arbitrary requests, paths, parent repositories and escaping symlinks', async () => {
    const h = await harness()
    await commit(h)
    await expect(h.ctx.repository.status({ workspaceId: Workspace.WorkspaceId('unknown') }, h.signal))
      .rejects.toThrow('REPOSITORY_UNKNOWN_WORKSPACE')
    await expect(h.ctx.repository.status({ workspaceId: h.workspaceId, cwd: h.cwd } as Repository.RepositoryRequest, h.signal))
      .rejects.toThrow('REPOSITORY_INVALID_REQUEST')
    for (const path of ['../outside', '/etc/passwd', '.git/config', 'folder/../same.txt', 'C:/outside', 'same.txt\0tail']) {
      await expect(h.diff(path, 'unstaged')).rejects.toThrow('REPOSITORY_INVALID_PATH')
    }
    await expect(h.diff('same.txt', 'staged')).rejects.toThrow('REPOSITORY_STATUS_CHANGED')
    await symlink(h.root, join(h.cwd, 'escape'), 'dir')
    await symlink(join(h.cwd, 'same.txt'), join(h.cwd, 'link'))
    await expect(h.diff('escape/cordis.yml', 'untracked')).rejects.toThrow('REPOSITORY_UNSUPPORTED_PATH')
    await expect(h.diff('link', 'untracked')).rejects.toThrow('REPOSITORY_UNSUPPORTED_PATH')
    const child = join(h.cwd, 'child')
    await mkdir(child)
    const workspace = await h.ctx.workspaceRegistry.create(child)
    await expect(h.ctx.repository.inspect({ workspaceId: workspace.id }, h.signal)).rejects.toThrow('REPOSITORY_NOT_FOUND')
    const outside = join(h.root, 'no-repo')
    await mkdir(outside)
    const noRepo = await h.ctx.workspaceRegistry.create(outside)
    await expect(h.ctx.repository.inspect({ workspaceId: noRepo.id }, h.signal)).rejects.toThrow('REPOSITORY_NOT_FOUND')
    await rename(h.cwd, h.cwd + '-moved')
    await expect(h.status()).rejects.toThrow('REPOSITORY_WORKSPACE_UNAVAILABLE')
  })

  it('refuses external Git metadata and promisor repositories without fetching', async () => {
    const h = await harness()
    await h.ok('config', 'remote.origin.url', 'https://user:secret@example.invalid/private')
    await h.ok('config', 'remote.origin.promisor', 'true')
    await expect(h.inspect()).rejects.toThrow('REPOSITORY_UNSUPPORTED_PARTIAL_CLONE')
    await h.ok('config', '--unset', 'remote.origin.promisor')
    const external = join(h.root, 'external-git-dir')
    await rename(join(h.cwd, '.git'), external)
    await writeFile(join(h.cwd, '.git'), 'gitdir: ' + external + '\n')
    await expect(h.inspect()).rejects.toThrow('REPOSITORY_UNSUPPORTED_WORKTREE')
  })

  it.each(['config', 'HEAD', 'index', 'packed-refs', 'refs/heads/escape', 'objects/info/escaped'])('rejects external %s symlinks before any Git command', async (name) => {
    const h = await harness()
    await commit(h)
    const external = join(h.root, 'outside-secret')
    await writeFile(external, '[remote "outside"]\nurl=https://secret:password@outside.invalid/private\n')
    const path = join(h.cwd, '.git', name)
    await rm(path, { force: true })
    await symlink(external, path)
    const spawn = vi.spyOn(h.ctx.subprocess, 'spawn')
    spawn.mockClear()
    for (const operation of [h.inspect, h.status, () => h.diff('same.txt', 'unstaged')]) {
      await expect(operation()).rejects.toThrow('REPOSITORY_UNSUPPORTED_METADATA')
      expect(spawn).not.toHaveBeenCalled()
    }
  })

  it('rejects symlinked metadata roots and parents before any Git invocation', async () => {
    const h = await harness()
    const actual = join(h.root, 'outside-git')
    await rename(join(h.cwd, '.git'), actual)
    await symlink(actual, join(h.cwd, '.git'), 'dir')
    const spawn = vi.spyOn(h.ctx.subprocess, 'spawn')
    spawn.mockClear()
    await expect(h.inspect()).rejects.toThrow('REPOSITORY_UNSUPPORTED_WORKTREE')
    expect(spawn).not.toHaveBeenCalled()
    await rm(join(h.cwd, '.git'))
    await rename(actual, join(h.cwd, '.git'))
    await rename(join(h.cwd, '.git', 'objects'), join(h.root, 'outside-objects'))
    await symlink(join(h.root, 'outside-objects'), join(h.cwd, '.git', 'objects'), 'dir')
    await expect(h.inspect()).rejects.toThrow('REPOSITORY_UNSUPPORTED_METADATA')
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each(['include.path', 'includeIf.onbranch:main.path'])('rejects %s without following even invalid outside configuration', async (key) => {
    const h = await harness()
    const outside = join(h.root, 'outside-invalid-config')
    await writeFile(outside, 'invalid Git syntax containing private credentials\n')
    await h.ok('config', key, outside)
    const spawn = vi.spyOn(h.ctx.subprocess, 'spawn')
    spawn.mockClear()
    await expect(h.inspect()).rejects.toThrow('REPOSITORY_UNSUPPORTED_INCLUDES')
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0]?.[0].argv).toEqual(expect.arrayContaining(['config', '--file', join(h.cwd, '.git', 'config'), '--no-includes']))
  })

  it.each(['commondir', 'objects/info/alternates', 'objects/info/http-alternates', 'objects/pack/pack-marker.promisor'])('rejects %s indirections before Git', async (name) => {
    const h = await harness()
    await writeFile(join(h.cwd, '.git', name), '/secret/outside\n')
    const spawn = vi.spyOn(h.ctx.subprocess, 'spawn')
    spawn.mockClear()
    await expect(h.inspect()).rejects.toThrow(name.endsWith('.promisor') ? 'REPOSITORY_UNSUPPORTED_PARTIAL_CLONE' : 'REPOSITORY_UNSUPPORTED_METADATA')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('refuses configured external worktrees and escaping symbolic references', async () => {
    const h = await harness()
    await h.ok('config', 'core.worktree', h.root)
    await expect(h.inspect()).rejects.toThrow('REPOSITORY_UNSUPPORTED_WORKTREE')
    await h.ok('config', '--unset', 'core.worktree')
    await writeFile(join(h.cwd, '.git', 'HEAD'), 'ref: refs/../../outside\n')
    const spawn = vi.spyOn(h.ctx.subprocess, 'spawn')
    spawn.mockClear()
    await expect(h.inspect()).rejects.toThrow('REPOSITORY_UNSUPPORTED_METADATA')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('bounds and cancels the complete metadata scan before spawning Git', async () => {
    const items = await harness({ maxMetadataItems: 1 })
    const spawnItems = vi.spyOn(items.ctx.subprocess, 'spawn')
    spawnItems.mockClear()
    await expect(items.inspect()).rejects.toThrow('REPOSITORY_METADATA_ITEM_LIMIT')
    expect(spawnItems).not.toHaveBeenCalled()
    const bytes = await harness({ maxMetadataBytes: 1 })
    const spawnBytes = vi.spyOn(bytes.ctx.subprocess, 'spawn')
    spawnBytes.mockClear()
    await expect(bytes.inspect()).rejects.toThrow('REPOSITORY_METADATA_BYTE_LIMIT')
    expect(spawnBytes).not.toHaveBeenCalled()
    const cancelled = await harness()
    const controller = new AbortController()
    const lstat = cancelled.ctx.fs.lstat.bind(cancelled.ctx.fs)
    vi.spyOn(cancelled.ctx.fs, 'lstat').mockImplementation(async (path, opts, signal) => {
      const info = await lstat(path, opts, signal)
      if (path.endsWith('HEAD')) controller.abort()
      return info
    })
    const spawnCancelled = vi.spyOn(cancelled.ctx.subprocess, 'spawn')
    spawnCancelled.mockClear()
    await expect(cancelled.ctx.repository.inspect({ workspaceId: cancelled.workspaceId }, controller.signal)).rejects.toThrow('REPOSITORY_CANCELLED')
    expect(spawnCancelled).not.toHaveBeenCalled()
  })

  it('accepts the real sandbox-local provider in read-only mode', async () => {
    const h = await harness({}, true)
    expect(h.ctx.fs).toBeInstanceOf(SandboxFS.SandboxedFileSystem)
    expect(await h.inspect()).toMatchObject({ branch: 'main', head: null })
  })

  it('enforces complete status record and output bounds, including multibyte response overhead', async () => {
    const h = await harness({ maxItems: 1 })
    await writeFile(join(h.cwd, 'one'), '1')
    await writeFile(join(h.cwd, 'two'), '2')
    await expect(h.status()).rejects.toThrow('REPOSITORY_ITEM_LIMIT')
    const small = await harness({ maxBytes: 1 })
    await expect(small.inspect()).rejects.toThrow('REPOSITORY_BYTE_LIMIT')
    const bytes = await harness({ maxBytes: 300 })
    await writeFile(join(bytes.cwd, 'áéç'.repeat(37)), 'new')
    const raw = await bytes.ok('status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignore-submodules=all')
    expect(Buffer.byteLength(raw)).toBeLessThan(300)
    await expect(bytes.status()).rejects.toThrow('REPOSITORY_BYTE_LIMIT')
    const diff = await harness({ maxBytes: 800 })
    await writeFile(join(diff.cwd, 'large'), 'ã'.repeat(1000))
    await expect(diff.diff('large', 'untracked')).rejects.toThrow('REPOSITORY_BYTE_LIMIT')
  })

  it('accepts exact complete multibyte JSON byte limits and rejects one byte less', async () => {
    const base = await harness()
    const path = 'áéç.txt'
    await writeFile(join(base.cwd, path), 'new')
    const status = await base.status()
    const limit = Buffer.byteLength(JSON.stringify(status))
    const exact = await harness({ maxBytes: limit })
    await writeFile(join(exact.cwd, path), 'new')
    expect(await exact.status()).toEqual(status)
    const less = await harness({ maxBytes: limit - 1 })
    await writeFile(join(less.cwd, path), 'new')
    await expect(less.status()).rejects.toThrow('REPOSITORY_BYTE_LIMIT')
  })

  it('scrubs ambient Git controls and never invokes external diff or textconv', async () => {
    const h = await harness()
    await commit(h)
    await writeFile(join(h.cwd, 'same.txt'), 'changed\n')
    await h.ok('config', 'diff.external', 'nonexistent-secret-external-diff')
    await h.ok('config', 'diff.danger.textconv', 'nonexistent-secret-textconv')
    await h.ok('config', 'core.fsmonitor', 'nonexistent-secret-fsmonitor')
    await writeFile(join(h.cwd, '.gitattributes'), '*.txt diff=danger\n')
    vi.stubEnv('GIT_DIR', '/secret/arbitrary-repo')
    vi.stubEnv('GIT_WORK_TREE', '/secret/arbitrary-worktree')
    vi.stubEnv('GIT_CONFIG_COUNT', '1')
    vi.stubEnv('GIT_CONFIG_KEY_0', 'diff.external')
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'nonexistent-secret-environment-diff')
    vi.stubEnv('GIT_CONFIG_PARAMETERS', "'filter.injected.clean=nonexistent-secret-environment-filter'")
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/secret/arbitrary-global-config')
    vi.stubEnv('GIT_EXTERNAL_DIFF', 'nonexistent-secret-environment-diff')
    vi.stubEnv('GIT_ASKPASS', 'nonexistent-secret-askpass')
    vi.stubEnv('SSH_ASKPASS', 'nonexistent-secret-askpass')
    vi.stubEnv('GIT_COMMON_DIR', '/secret/arbitrary-common-dir')
    vi.stubEnv('GIT_OBJECT_DIRECTORY', '/secret/arbitrary-objects')
    vi.stubEnv('GIT_ALTERNATE_OBJECT_DIRECTORIES', '/secret/arbitrary-alternates')
    vi.stubEnv('GIT_TRACE', join(h.root, 'trace-marker'))
    vi.stubEnv('GIT_TRACE2_EVENT', join(h.root, 'trace2-marker'))
    vi.stubEnv('DEEPSEEK_API_KEY', 'fixture-secret')
    expect((await h.diff('same.txt', 'unstaged')).text).toContain('+changed')
    expect((await h.inspect()).branch).toBe('main')
    await expect(readFile(join(h.root, 'trace-marker'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(h.root, 'trace2-marker'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['clean', 'process'])('refuses %s filters before inspect, status or any diff side can execute them', async (kind) => {
    const h = await harness()
    await commit(h)
    await writeFile(join(h.cwd, 'same.txt'), 'staged\n')
    await h.ok('add', '--', 'same.txt')
    await writeFile(join(h.cwd, 'same.txt'), 'unstaged\n')
    await writeFile(join(h.cwd, 'new.txt'), 'untracked\n')
    const script = join(h.root, 'marker.mjs'), marker = join(h.root, 'filter-marker')
    await writeFile(script, 'import {writeFileSync} from "node:fs";writeFileSync(process.argv[2],"executed");process.stdin.pipe(process.stdout)')
    const command = [process.execPath, script, marker].map(value => JSON.stringify(value)).join(' ')
    await h.ok('config', 'filter.marker.' + kind, command)
    await writeFile(join(h.cwd, '.gitattributes'), '*.txt filter=marker\n')
    // Positive control uses disposable Git directly; the command executes even if a process filter fails its protocol.
    await h.git('diff', '--no-ext-diff', '--no-textconv', '--', 'same.txt')
    expect(await readFile(marker, 'utf8')).toBe('executed')
    await rm(marker)
    const operations = [h.inspect, h.status, () => h.diff('same.txt', 'staged'), () => h.diff('same.txt', 'unstaged'),
      () => h.diff('new.txt', 'untracked')]
    for (const operation of operations) {
      await expect(operation()).rejects.toThrow('REPOSITORY_UNSUPPORTED_FILTERS')
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it.each(['include', 'includeIf', 'worktree', 'global-lfs', 'system-lfs'])('rejects repository indirection or isolates host-only %s configuration', async (source) => {
    const h = await harness()
    await commit(h)
    await writeFile(join(h.cwd, 'same.txt'), 'changed\n')
    const script = join(h.root, 'included-marker.mjs'), marker = join(h.root, 'included-marker')
    await writeFile(script, 'import {writeFileSync} from "node:fs";writeFileSync(process.argv[2],"executed");process.stdin.pipe(process.stdout)')
    const command = [process.execPath, script, marker].map(value => JSON.stringify(value)).join(' ')
    const file = source === 'global-lfs' ? join(h.root, '.gitconfig')
      : source === 'system-lfs' ? join(h.root, 'system.config') : join(h.root, 'included.config')
    if (source === 'worktree') {
      await h.ok('config', 'extensions.worktreeConfig', 'true')
      await h.ok('config', '--worktree', 'filter.lfs.process', command)
    } else await h.ok('config', '--file', file, 'filter.lfs.process', command)
    if (source === 'include') await h.ok('config', 'include.path', file)
    if (source === 'includeIf') await h.ok('config', 'includeIf.onbranch:main.path', file)
    await writeFile(join(h.cwd, '.gitattributes'), '*.txt filter=lfs\n')
    for (const operation of [h.inspect, h.status, () => h.diff('same.txt', 'unstaged')]) {
      if (source === 'global-lfs' || source === 'system-lfs') await expect(operation()).rejects.toThrow('REPOSITORY_UNSUPPORTED_FILTERS')
      else await expect(operation()).rejects.toThrow(source === 'worktree' ? 'REPOSITORY_UNSUPPORTED_METADATA' : 'REPOSITORY_UNSUPPORTED_INCLUDES')
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('refuses attribute drivers omitted by disabled global config without executing conversions', async () => {
    const h = await harness()
    await commit(h)
    await writeFile(join(h.cwd, 'same.txt'), 'changed\n')
    const script = join(h.root, 'global-clean.mjs'), marker = join(h.root, 'global-clean-marker')
    await writeFile(script, 'import {writeFileSync} from "node:fs";writeFileSync(process.argv[2],"executed");process.stdin.pipe(process.stdout)')
    const command = [process.execPath, script, marker].map(value => JSON.stringify(value)).join(' ')
    await h.ok('config', '--file', join(h.root, '.gitconfig'), 'filter.lfs.clean', command)
    await writeFile(join(h.cwd, '.gitattributes'), '*.txt filter=lfs\n')
    await h.git('-c', 'filter.lfs.clean=' + command, 'diff', '--no-ext-diff', '--no-textconv', '--', 'same.txt')
    expect(await readFile(marker, 'utf8')).toBe('executed')
    await rm(marker)
    for (const operation of [h.inspect, h.status, () => h.diff('same.txt', 'unstaged')]) {
      await expect(operation()).rejects.toThrow('REPOSITORY_UNSUPPORTED_FILTERS')
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('checks indexed attributes even when the worktree unsets the driver', async () => {
    const h = await harness()
    await commit(h)
    await writeFile(join(h.cwd, '.gitattributes'), '*.txt filter=missing\n')
    await h.ok('add', '--', '.gitattributes')
    await writeFile(join(h.cwd, '.gitattributes'), '*.txt -filter\n')
    await expect(h.inspect()).rejects.toThrow('REPOSITORY_UNSUPPORTED_FILTERS')
  })

  it('refuses symlinked attribute ancestors before attribute lookup', async () => {
    const h = await harness()
    await mkdir(join(h.cwd, 'dir'))
    await commit(h, 'dir/file.txt')
    await rename(join(h.cwd, 'dir'), join(h.root, 'external-directory'))
    await writeFile(join(h.root, 'external-directory', '.gitattributes'), '*.txt filter=missing\n')
    await symlink(join(h.root, 'external-directory'), join(h.cwd, 'dir'), 'dir')
    const spawn = vi.spyOn(h.ctx.subprocess, 'spawn')
    spawn.mockClear()
    await expect(h.status()).rejects.toThrow('REPOSITORY_UNSUPPORTED_PATH')
    expect(spawn.mock.calls.some(([spec]) => spec.argv.includes('check-attr'))).toBe(false)
  })

  it('permits empty filters and suppresses a real repository fsmonitor command on every read', async () => {
    const h = await harness()
    await commit(h)
    await writeFile(join(h.cwd, 'same.txt'), 'changed\n')
    const script = join(h.root, 'fsmonitor.mjs'), marker = join(h.root, 'fsmonitor-marker')
    await writeFile(script, 'import {writeFileSync} from "node:fs";writeFileSync(process.argv[2],"executed")')
    const command = [process.execPath, script, marker].map(value => JSON.stringify(value)).join(' ')
    await h.ok('config', 'core.fsmonitor', command)
    await h.ok('config', 'filter.empty.clean', '')
    await h.ok('config', 'filter.empty.process', '')
    await h.git('status', '--porcelain=v2')
    expect(await readFile(marker, 'utf8')).toBe('executed')
    await rm(marker)
    expect((await h.inspect()).branch).toBe('main')
    expect((await h.status()).unstaged).toMatchObject([{ path: 'same.txt' }])
    expect((await h.diff('same.txt', 'unstaged')).text).toContain('+changed')
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('disables external attribute and ignore sources without reading their symlinks', async () => {
    const h = await harness()
    const attributes = join(h.root, 'outside-attributes'), excludes = join(h.root, 'outside-excludes')
    await writeFile(attributes, '*.bin diff\n')
    await writeFile(excludes, 'new.bin\n')
    await h.ok('config', 'core.attributesFile', attributes)
    await h.ok('config', 'core.excludesFile', excludes)
    await writeFile(join(h.cwd, 'new.bin'), Buffer.from([0, 1, 2]))
    expect((await h.status()).untracked).toMatchObject([{ path: 'new.bin' }])
    expect(await h.diff('new.bin', 'untracked')).toMatchObject({ binary: true, text: '' })
    await symlink(attributes, join(h.cwd, '.gitattributes'))
    expect(await h.diff('new.bin', 'untracked')).toMatchObject({ binary: true, text: '' })
  })

  it('sanitizes missing Git, spawn failures and nonzero exits', async () => {
    const h = await harness()
    vi.spyOn(h.ctx.subprocess, 'resolveExecutable').mockRejectedValueOnce(new Error('secret path and password'))
    await expect(h.status()).rejects.toThrow('REPOSITORY_GIT_UNAVAILABLE')
    const spawn = h.ctx.subprocess.spawn.bind(h.ctx.subprocess)
    vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce(spec => spawn({ ...spec, argv: ['/nonexistent-secret-executable'] }))
    await expect(h.status()).rejects.toThrow('REPOSITORY_IO_FAILED')
    vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce(spec => spawn({ ...spec, argv: [process.execPath, '-e',
      'process.stderr.write("secret-password");process.exit(7)'] }))
    await expect(h.status()).rejects.toThrow('REPOSITORY_PROCESS_FAILED')
  })

  it('refuses signal exits, invalid UTF-8 and timed-out exit zero as successful Git output', async () => {
    const h = await harness({ timeoutMs: 80, graceMs: 30 })
    const original = h.ctx.subprocess.spawn.bind(h.ctx.subprocess)
    vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce(spec => original({ ...spec,
      argv: [process.execPath, '-e', 'process.kill(process.pid,"SIGTERM")'] }))
    await expect(h.status()).rejects.toThrow('REPOSITORY_PROCESS_FAILED')
    vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce(spec => original({ ...spec,
      argv: [process.execPath, '-e', 'process.stdout.write(Buffer.from([255]))'] }))
    await expect(h.status()).rejects.toThrow('REPOSITORY_UNSUPPORTED_ENCODING')
    vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce(spec => original({ ...spec,
      argv: [process.execPath, '-e', 'process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000)'] }))
    await expect(h.status()).rejects.toThrow('REPOSITORY_TIMEOUT')
  })

  it('rejects nonlocal current providers before executing commands and at load', async () => {
    const h = await harness()
    abstract class RemoteFS extends FileSystem {}
    abstract class RemoteProcess extends SubprocessRuntime {}
    const spawn = vi.spyOn(h.ctx.subprocess, 'spawn')
    spawn.mockClear()
    const localFS = h.ctx.fs
    Object.setPrototypeOf(localFS, RemoteFS.prototype)
    await expect(h.status()).rejects.toThrow('REPOSITORY_UNSUPPORTED_PROVIDER')
    expect(spawn).not.toHaveBeenCalled()
    const unsupported = new Context()
    unsupported.provide('fs', localFS)
    unsupported.provide('subprocess', h.ctx.subprocess)
    expect(() => new Repository.RepositoryService(unsupported)).toThrow('REPOSITORY_UNSUPPORTED_PROVIDER')
    await unsupported.fiber.dispose()
    Object.setPrototypeOf(localFS, LocalFS.LocalFileSystem.prototype)
    const localProcess = h.ctx.subprocess
    Object.setPrototypeOf(localProcess, RemoteProcess.prototype)
    await expect(h.status()).rejects.toThrow('REPOSITORY_UNSUPPORTED_PROVIDER')
    const unsupportedProcess = new Context()
    unsupportedProcess.provide('fs', localFS)
    unsupportedProcess.provide('subprocess', localProcess)
    expect(() => new Repository.RepositoryService(unsupportedProcess)).toThrow('REPOSITORY_UNSUPPORTED_PROVIDER')
    await unsupportedProcess.fiber.dispose()
    Object.setPrototypeOf(localProcess, Subprocess.LocalSubprocessRuntime.prototype)
  })

  it('validates finite Config values at construction', async () => {
    for (const config of [{ maxBytes: 0 }, { maxItems: Infinity }, { timeoutMs: NaN }, { graceMs: -1 }, { maxBytes: 1.5 },
      { maxMetadataItems: 0 }, { maxMetadataBytes: Infinity }]) {
      const ctx = new Context()
      expect(() => new Repository.RepositoryService(ctx, config)).toThrow('REPOSITORY_INVALID_CONFIG')
      await ctx.fiber.dispose()
    }
  })

  it('settles cancellation, timeout and disposal after managed process trees stop', async () => {
    const h = await harness({ timeoutMs: 100, graceMs: 30 })
    const originalSpawn = h.ctx.subprocess.spawn.bind(h.ctx.subprocess)
    const handles: ReturnType<typeof originalSpawn>[] = []
    const replace = () => vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce((spec: SubprocessSpawnSpec) => {
      const handle = originalSpawn({ ...spec, argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'] })
      handles.push(handle)
      return handle
    })
    replace()
    await expect(h.status()).rejects.toThrow('REPOSITORY_TIMEOUT')
    expect(await handles[0]?.waitForExit()).toBe(true)
    const controller = new AbortController()
    vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce((spec) => {
      const handle = originalSpawn({ ...spec, argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'] })
      handles.push(handle)
      controller.abort()
      return handle
    })
    const cancelled = h.ctx.repository.status({ workspaceId: h.workspaceId }, controller.signal)
    await expect(cancelled).rejects.toThrow('REPOSITORY_CANCELLED')
    // Disposal starts while a real managed child is alive, not only before command lookup.
    let started: (() => void) | undefined
    const ready = new Promise<void>((resolve) => { started = resolve })
    vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce((spec) => {
      const handle = originalSpawn({ ...spec, argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'] })
      handles.push(handle)
      started?.()
      return handle
    })
    const service = h.ctx.repository
    const pending = service.status({ workspaceId: h.workspaceId }, h.signal)
    const rejection = expect(pending).rejects.toThrow('REPOSITORY_DISPOSED')
    await ready
    const entry = [...h.ctx.loader.entries()].find(entry => entry.options.name === 'repository')
    if (!entry?.fiber) throw new Error('repository Loader fiber missing')
    await entry.fiber.dispose()
    await rejection
    expect(await handles.at(-1)?.waitForExit()).toBe(true)
    expect(h.ctx.get('repository')).toBeUndefined()
    await expect(service.status({ workspaceId: h.workspaceId }, h.signal)).rejects.toThrow('REPOSITORY_DISPOSED')
  })
})

it('refuses incomplete NUL records, malformed status and incomplete rename pairs', () => {
  expect(() => parsePorcelain('? file', 10)).toThrow('REPOSITORY_INVALID_STATUS')
  expect(() => parsePorcelain('2 R. N... 100644 100644 100644 a b R100 new\0', 10)).toThrow('REPOSITORY_INVALID_STATUS')
  expect(() => parsePorcelain('garbage\0', 10)).toThrow('REPOSITORY_INVALID_STATUS')
})
