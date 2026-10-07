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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arx-repository-private-')))
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
  const spawn = (spec: SubprocessSpawnSpec) => realSpawn({ ...spec, env: { ...spec.env,
    HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: join(root, '.config'), GIT_CONFIG_SYSTEM: join(root, 'system.config'),
  } })
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(spawn)
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
  return { root, cwd, ctx, workspaceId: workspace.id, signal, git, ok, spawn,
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

// Process output probes retain managed child creation, stream consumption and cleanup.
function replyOnce(h: Awaited<ReturnType<typeof harness>>, matches: (argv: readonly string[]) => boolean,
  text: string, exitCode = 0) {
  let replied = false
  return vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementation((spec) => {
    if (replied || !matches(spec.argv)) return h.spawn(spec)
    replied = true
    const encoded = Buffer.from(text).toString('base64')
    const emit = `()=>{process.stdout.write(Buffer.from("${encoded}","base64"));process.exitCode=${exitCode}}`
    const script = spec.stdio.stdin === 'pipe'
      ? `process.stdin.resume();process.stdin.once("end",${emit})` : `(${emit})()`
    return h.spawn({ ...spec, argv: [process.execPath, '-e', script] })
  })
}

// Only the request deadline uses this clock; process grace and tree-exit observation stay native.
function deadlineClock(timeoutMs: number) {
  const schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout
  const deadlines = new Map<ReturnType<typeof setTimeout>, () => void>()
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    if (delay !== timeoutMs) return schedule(callback, delay, ...args)
    const timer = schedule(() => {}, delay)
    deadlines.set(timer, () => { callback(...args) })
    return timer
  })
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation((timer) => {
    deadlines.delete(timer as ReturnType<typeof setTimeout>)
    cancel(timer)
  })
  return { expire() {
    expect(deadlines.size).toBe(1)
    for (const callback of deadlines.values()) callback()
  } }
}

// Prepare independent real repositories in hooks so each test budgets the operation it asserts.
// Keep native process-tree observation and request/grace deadlines active during every operation.
describe('host repository through real Loader, FS, registry and managed Git', () => {
  describe('separates both sides of one path, retains odd names, and never writes the index during reads', () => {
    let h: Awaited<ReturnType<typeof harness>>, odd: string, literal: string, before: Buffer
    beforeEach(async () => {
      h = await harness()
      await commit(h)
      await writeFile(join(h.cwd, 'same.txt'), 'staged\n')
      await h.ok('add', '--', 'same.txt')
      await writeFile(join(h.cwd, 'same.txt'), 'unstaged\n')
      odd = process.platform === 'win32' ? '- odd name áéç.txt' : '- odd\tname\náéç.txt'
      await writeFile(join(h.cwd, odd), 'new\n')
      literal = process.platform === 'win32' ? '[literal].txt' : ':(glob)*'
      await writeFile(join(h.cwd, literal), 'literal\n')
      before = await readFile(join(h.cwd, '.git/index'))
    })
    it('reports staged, unstaged and untracked paths without changing the index', async () => {
      const status = await h.status()
      expect(status.staged).toMatchObject([{ path: 'same.txt', xy: 'MM' }])
      expect(status.unstaged).toMatchObject([{ path: 'same.txt', xy: 'MM' }])
      expect(status.untracked.map(entry => entry.path)).toEqual(expect.arrayContaining([odd, literal]))
      expect(await readFile(join(h.cwd, '.git/index'))).toEqual(before)
      expect(h.ctx.get('agents')).toBeUndefined()
    })
    it.each(['staged', 'unstaged', 'odd', 'literal'] as const)('reads the %s preview without changing the index', async (side) => {
      const path = side === 'odd' ? odd : side === 'literal' ? literal : 'same.txt'
      const kind = side === 'odd' || side === 'literal' ? 'untracked' : side
      const added = side === 'odd' ? '+new' : side === 'literal' ? '+literal' : '+' + side
      expect((await h.diff(path, kind)).text).toContain(added)
      expect(await readFile(join(h.cwd, '.git/index'))).toEqual(before)
      expect(h.ctx.get('agents')).toBeUndefined()
    })
  })

  describe('nested diff paths', () => {
    let h: Awaited<ReturnType<typeof harness>>
    beforeEach(async () => {
      h = await harness()
      await mkdir(join(h.cwd, 'dir/subdir'), { recursive: true })
      await commit(h, 'dir/subdir/file.txt')
      await writeFile(join(h.cwd, 'dir/subdir/file.txt'), 'changed\n')
    })
    it('reads nested diff paths through every parent without changing their contents', async () => {
      expect((await h.diff('dir/subdir/file.txt', 'unstaged')).text).toContain('+changed')
      expect(await readFile(join(h.cwd, 'dir/subdir/file.txt'), 'utf8')).toBe('changed\n')
    })
  })

  describe('native path separator contract', () => {
    let h: Awaited<ReturnType<typeof harness>>
    const path = 'native\\separator.txt'
    beforeEach(async () => {
      h = await harness()
      if (process.platform === 'win32') {
        await mkdir(join(h.cwd, 'native'))
        await writeFile(join(h.cwd, 'native', 'separator.txt'), 'literal\n')
      } else await writeFile(join(h.cwd, path), 'literal\n')
    })
    it('preserves POSIX backslash names and rejects Windows backslash path notation', async () => {
      if (process.platform === 'win32') await expect(h.diff(path, 'untracked')).rejects.toThrow('REPOSITORY_INVALID_PATH')
      else {
        expect((await h.diff(path, 'untracked')).text).toContain('+literal')
        expect(await readFile(join(h.cwd, path), 'utf8')).toBe('literal\n')
      }
    })
  })

  describe('reports renames, deletes, binary files, unborn and detached heads', () => {
    let h: Awaited<ReturnType<typeof harness>>
    describe('unborn head', () => {
      beforeEach(async () => { h = await harness() })
      it('reports an unborn branch without an upstream', async () => {
        expect(await h.inspect()).toMatchObject({ branch: 'main', head: null, aheadBehind: null })
      })
    })
    describe('rename', () => {
      beforeEach(async () => {
        h = await harness()
        await commit(h)
        await h.ok('mv', 'same.txt', 'renamed.txt')
      })
      it('reports the original path in staged status', async () => {
        expect((await h.status()).staged).toMatchObject([{ path: 'renamed.txt', originalPath: 'same.txt', xy: 'R.' }])
      })
      it('previews the staged renamed contents', async () => {
        expect((await h.diff('renamed.txt', 'staged')).text).toContain('+base')
      })
    })
    describe('delete', () => {
      beforeEach(async () => {
        h = await harness()
        await commit(h)
        await h.ok('mv', 'same.txt', 'renamed.txt')
        await h.ok('commit', '-m', 'rename')
        await rm(join(h.cwd, 'renamed.txt'))
      })
      it('reports the deleted path in unstaged status', async () => {
        expect((await h.status()).unstaged).toMatchObject([{ path: 'renamed.txt', xy: '.D' }])
      })
      it('previews the deleted contents', async () => {
        expect((await h.diff('renamed.txt', 'unstaged')).text).toContain('-base')
      })
    })
    for (const side of ['untracked', 'staged'] as const) {
      describe(side + ' binary file', () => {
        beforeEach(async () => {
          h = await harness()
          await commit(h)
          await writeFile(join(h.cwd, 'binary'), Buffer.from([0, 1, 2, 3]))
          if (side === 'staged') await h.ok('add', '--', 'binary')
        })
        it('reports binary contents without a text preview', async () => {
          expect(await h.diff('binary', side)).toMatchObject({ binary: true, text: '' })
        })
      })
    }
    describe('detached head', () => {
      beforeEach(async () => {
        h = await harness()
        await commit(h)
        await h.ok('checkout', '--detach', 'HEAD')
      })
      it('reports the object id without a branch', async () => {
        const detached = await h.inspect()
        expect(detached.branch).toBeNull()
        expect(detached.head).toMatch(/^[a-f0-9]{40}$/)
      })
    })
  })

  describe('reports conflicts independently and refuses conflict previews', () => {
    let h: Awaited<ReturnType<typeof harness>>
    beforeEach(async () => {
      h = await harness()
      await commit(h)
      await h.ok('checkout', '-b', 'other')
      await writeFile(join(h.cwd, 'same.txt'), 'other\n')
      await h.ok('commit', '-am', 'other')
      await h.ok('checkout', 'main')
      await writeFile(join(h.cwd, 'same.txt'), 'main\n')
      await h.ok('commit', '-am', 'main')
      expect((await h.git('merge', 'other')).code).toBe(1)
    })
    it('reports the unmerged status', async () => {
      expect((await h.status()).unmerged).toMatchObject([{ path: 'same.txt', xy: 'UU' }])
    })
    it('refuses a conflict preview', async () => {
      await expect(h.diff('same.txt', 'unstaged')).rejects.toThrow('REPOSITORY_UNSUPPORTED_CONFLICT')
    })
  })

  describe('sanitizes credential URLs and uses only local upstream counters', () => {
    const privateParts = {
      user: 'arx-userinfo-sentinel',
      password: 'arx-password-sentinel',
      httpsPath: 'arx-https-path-sentinel',
      query: 'arx-query-sentinel',
      fragment: 'arx-fragment-sentinel',
      sshPath: 'arx-ssh-path-sentinel',
      localPath: 'arx-local-path-sentinel',
    }
    let h: Awaited<ReturnType<typeof harness>>
    beforeEach(async () => {
      h = await harness()
      await commit(h)
      await h.ok('remote', 'add', 'origin',
        `https://${privateParts.user}:${privateParts.password}@example.invalid/${privateParts.httpsPath}?token=${privateParts.query}#${privateParts.fragment}`)
      await h.ok('remote', 'add', 'ssh', `${privateParts.user}@example.invalid:${privateParts.sshPath}`)
      await h.ok('remote', 'add', 'local', `/${privateParts.localPath}`)
      await h.ok('update-ref', 'refs/remotes/origin/main', 'HEAD')
      await h.ok('config', 'branch.main.remote', 'origin')
      await h.ok('config', 'branch.main.merge', 'refs/heads/main')
    })
    it('sanitizes remotes and reports synchronized local counters', async () => {
      const inspection = await h.inspect()
      expect(inspection.aheadBehind).toEqual({ ahead: 0, behind: 0 })
      expect(inspection.remotes).toEqual([
        { name: 'origin', host: 'example.invalid', transport: 'https' },
        { name: 'ssh', host: 'example.invalid', transport: 'ssh' },
        { name: 'local', host: null, transport: null },
      ])
      expect(inspection.root).toBe(h.cwd)
      expect(inspection.root).toContain('private')
      const serialized = JSON.stringify(inspection)
      for (const part of Object.values(privateParts)) expect(serialized).not.toContain(part)
    })
    describe('ahead of the local upstream', () => {
      beforeEach(async () => {
        await writeFile(join(h.cwd, 'same.txt'), 'ahead\n')
        await h.ok('commit', '-am', 'ahead')
      })
      it('reports the locally committed difference', async () => {
        expect((await h.inspect()).aheadBehind).toEqual({ ahead: 1, behind: 0 })
      })
    })
  })

  describe('refuses unknown workspace, arbitrary requests, paths, parent repositories and escaping symlinks', () => {
    let h: Awaited<ReturnType<typeof harness>>
    beforeEach(async () => {
      h = await harness()
      await commit(h)
    })
    it('rejects unknown workspaces and arbitrary request properties', async () => {
      await expect(h.ctx.repository.status({ workspaceId: Workspace.WorkspaceId('unknown') }, h.signal))
        .rejects.toThrow('REPOSITORY_UNKNOWN_WORKSPACE')
      await expect(h.ctx.repository.status({ workspaceId: h.workspaceId, cwd: h.cwd } as Repository.RepositoryRequest, h.signal))
        .rejects.toThrow('REPOSITORY_INVALID_REQUEST')
    })
    it.each(['../outside', '/etc/passwd', '.git/config', 'folder/../same.txt', 'C:/outside', 'same.txt\0tail'])
    ('rejects invalid path %j before any preview', async (path) => {
      await expect(h.diff(path, 'unstaged')).rejects.toThrow('REPOSITORY_INVALID_PATH')
    })
    it('refuses a preview whose requested side is unchanged', async () => {
      await expect(h.diff('same.txt', 'staged')).rejects.toThrow('REPOSITORY_STATUS_CHANGED')
    })
    it('refuses an escaping directory link', async () => {
      await symlink(h.root, join(h.cwd, 'escape'), 'dir')
      await expect(h.diff('escape/cordis.yml', 'untracked')).rejects.toThrow('REPOSITORY_UNSUPPORTED_PATH')
    })
    it('refuses a file link even inside the workspace', async () => {
      await symlink(join(h.cwd, 'same.txt'), join(h.cwd, 'link'))
      await expect(h.diff('link', 'untracked')).rejects.toThrow('REPOSITORY_UNSUPPORTED_PATH')
    })
    it('refuses parent repositories and paths without a repository', async () => {
      const child = join(h.cwd, 'child')
      await mkdir(child)
      const workspace = await h.ctx.workspaceRegistry.create(child)
      await expect(h.ctx.repository.inspect({ workspaceId: workspace.id }, h.signal)).rejects.toThrow('REPOSITORY_NOT_FOUND')
      const outside = join(h.root, 'no-repo')
      await mkdir(outside)
      const noRepo = await h.ctx.workspaceRegistry.create(outside)
      await expect(h.ctx.repository.inspect({ workspaceId: noRepo.id }, h.signal)).rejects.toThrow('REPOSITORY_NOT_FOUND')
    })
    it('refuses a workspace that moved after registration', async () => {
      await rename(h.cwd, h.cwd + '-moved')
      await expect(h.status()).rejects.toThrow('REPOSITORY_WORKSPACE_UNAVAILABLE')
    })
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

  describe('enforces complete status record and output bounds, including multibyte response overhead', () => {
    let h: Awaited<ReturnType<typeof harness>>
    describe('item limit', () => {
      beforeEach(async () => {
        h = await harness({ maxItems: 1 })
        await writeFile(join(h.cwd, 'one'), '1')
        await writeFile(join(h.cwd, 'two'), '2')
      })
      it('bounds complete status records', async () => {
        await expect(h.status()).rejects.toThrow('REPOSITORY_ITEM_LIMIT')
      })
    })
    describe('command byte limit', () => {
      beforeEach(async () => { h = await harness({ maxBytes: 1 }) })
      it('bounds command output', async () => {
        await expect(h.inspect()).rejects.toThrow('REPOSITORY_BYTE_LIMIT')
      })
    })
    describe('multibyte response overhead', () => {
      beforeEach(async () => {
        h = await harness({ maxBytes: 300 })
        await writeFile(join(h.cwd, 'áéç'.repeat(37)), 'new')
      })
      it('keeps the complete wire output below the response limit', async () => {
        const raw = await h.ok('status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignore-submodules=all')
        expect(Buffer.byteLength(raw)).toBeLessThan(300)
      })
      it('bounds the complete encoded response', async () => {
        await expect(h.status()).rejects.toThrow('REPOSITORY_BYTE_LIMIT')
      })
    })
    describe('diff byte limit', () => {
      beforeEach(async () => {
        h = await harness({ maxBytes: 800 })
        await writeFile(join(h.cwd, 'large'), 'ã'.repeat(1000))
      })
      it('bounds a complete multibyte diff', async () => {
        await expect(h.diff('large', 'untracked')).rejects.toThrow('REPOSITORY_BYTE_LIMIT')
      })
    })
  })

  for (const delta of [0, -1]) {
    describe(`complete multibyte JSON byte limit ${delta}`, () => {
      let h: Awaited<ReturnType<typeof harness>>, status: Repository.RepositoryStatus
      beforeEach(async () => {
        const base = await harness()
        const path = 'áéç.txt'
        await writeFile(join(base.cwd, path), 'new')
        // Native Git init settings vary in size; this case measures the complete JSON response limit.
        await writeFile(join(base.cwd, '.git/config'), '[core]\nrepositoryformatversion=0\n')
        status = await base.status()
        const limit = Buffer.byteLength(JSON.stringify(status))
        h = await harness({ maxBytes: limit + delta })
        await writeFile(join(h.cwd, '.git/config'), '[core]\nrepositoryformatversion=0\n')
        await writeFile(join(h.cwd, path), 'new')
      })
      it('accepts exact complete multibyte JSON byte limits and rejects one byte less', async () => {
        if (delta === 0) expect(await h.status()).toEqual(status)
        else await expect(h.status()).rejects.toThrow('REPOSITORY_BYTE_LIMIT')
      })
    })
  }

  describe('scrubs ambient Git controls and never invokes external diff or textconv', () => {
    let h: Awaited<ReturnType<typeof harness>>
    beforeEach(async () => {
      h = await harness()
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
    })
    it.each(['inspect', 'diff'])('scrubs the environment of %s', async (operation) => {
      if (operation === 'inspect') expect((await h.inspect()).branch).toBe('main')
      else expect((await h.diff('same.txt', 'unstaged')).text).toContain('+changed')
      await expect(readFile(join(h.root, 'trace-marker'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(join(h.root, 'trace2-marker'))).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  for (const kind of ['clean', 'process']) {
    describe('refuses ' + kind + ' filters before inspect, status or any diff side can execute them', () => {
      let h: Awaited<ReturnType<typeof harness>>, marker: string
      beforeEach(async () => {
        h = await harness()
        await commit(h)
        await writeFile(join(h.cwd, 'same.txt'), 'staged\n')
        await h.ok('add', '--', 'same.txt')
        await writeFile(join(h.cwd, 'same.txt'), 'unstaged\n')
        await writeFile(join(h.cwd, 'new.txt'), 'untracked\n')
        const script = join(h.root, 'marker.mjs')
        marker = join(h.root, 'filter-marker')
        await writeFile(script, 'import {writeFileSync} from "node:fs";writeFileSync(process.argv[2],"executed");process.stdin.pipe(process.stdout)')
        const command = [process.execPath, script, marker].map(value => JSON.stringify(value)).join(' ')
        await h.ok('config', 'filter.marker.' + kind, command)
        await writeFile(join(h.cwd, '.gitattributes'), '*.txt filter=marker\n')
        // Positive control uses disposable Git directly; a process filter need not implement Git's protocol to execute.
        await h.git('diff', '--no-ext-diff', '--no-textconv', '--', 'same.txt')
        expect(await readFile(marker, 'utf8')).toBe('executed')
        await rm(marker)
      })
      it.each(['inspect', 'status', 'staged', 'unstaged', 'untracked'] as const)('rejects the filter before %s', async (operation) => {
        const result = operation === 'inspect' ? h.inspect() : operation === 'status' ? h.status()
          : h.diff(operation === 'untracked' ? 'new.txt' : 'same.txt', operation)
        await expect(result).rejects.toThrow('REPOSITORY_UNSUPPORTED_FILTERS')
        await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      })
    })
  }

  for (const source of ['include', 'includeIf', 'worktree', 'global-lfs', 'system-lfs']) {
    describe('rejects repository indirection or isolates host-only ' + source + ' configuration', () => {
      let h: Awaited<ReturnType<typeof harness>>, marker: string
      beforeEach(async () => {
        h = await harness()
        await commit(h)
        await writeFile(join(h.cwd, 'same.txt'), 'changed\n')
        const script = join(h.root, 'included-marker.mjs')
        marker = join(h.root, 'included-marker')
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
      })
      it.each(['inspect', 'status', 'diff'])('checks isolation before %s', async (operation) => {
        const result = operation === 'inspect' ? h.inspect() : operation === 'status' ? h.status() : h.diff('same.txt', 'unstaged')
        if (source === 'global-lfs' || source === 'system-lfs') await expect(result).rejects.toThrow('REPOSITORY_UNSUPPORTED_FILTERS')
        else await expect(result).rejects.toThrow(source === 'worktree' ? 'REPOSITORY_UNSUPPORTED_METADATA' : 'REPOSITORY_UNSUPPORTED_INCLUDES')
        await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      })
    })
  }

  describe('refuses attribute drivers omitted by disabled global config without executing conversions', () => {
    let h: Awaited<ReturnType<typeof harness>>, marker: string
    beforeEach(async () => {
      h = await harness()
      await commit(h)
      await writeFile(join(h.cwd, 'same.txt'), 'changed\n')
      const script = join(h.root, 'global-clean.mjs')
      marker = join(h.root, 'global-clean-marker')
      await writeFile(script, 'import {writeFileSync} from "node:fs";writeFileSync(process.argv[2],"executed");process.stdin.pipe(process.stdout)')
      const command = [process.execPath, script, marker].map(value => JSON.stringify(value)).join(' ')
      await h.ok('config', '--file', join(h.root, '.gitconfig'), 'filter.lfs.clean', command)
      await writeFile(join(h.cwd, '.gitattributes'), '*.txt filter=lfs\n')
      await h.git('-c', 'filter.lfs.clean=' + command, 'diff', '--no-ext-diff', '--no-textconv', '--', 'same.txt')
      expect(await readFile(marker, 'utf8')).toBe('executed')
      await rm(marker)
    })
    it.each(['inspect', 'status', 'diff'])('refuses the driver before %s', async (operation) => {
      const result = operation === 'inspect' ? h.inspect() : operation === 'status' ? h.status() : h.diff('same.txt', 'unstaged')
      await expect(result).rejects.toThrow('REPOSITORY_UNSUPPORTED_FILTERS')
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('checks indexed attributes even when the worktree unsets the driver', () => {
    let h: Awaited<ReturnType<typeof harness>>
    beforeEach(async () => {
      h = await harness()
      await commit(h)
      await writeFile(join(h.cwd, '.gitattributes'), '*.txt filter=missing\n')
      await h.ok('add', '--', '.gitattributes')
      await writeFile(join(h.cwd, '.gitattributes'), '*.txt -filter\n')
    })
    it('refuses a filter from the indexed attributes', async () => {
      await expect(h.inspect()).rejects.toThrow('REPOSITORY_UNSUPPORTED_FILTERS')
    })
  })

  describe('refuses symlinked attribute ancestors before attribute lookup', () => {
    let h: Awaited<ReturnType<typeof harness>>
    beforeEach(async () => {
      h = await harness()
      await mkdir(join(h.cwd, 'dir'))
      await commit(h, 'dir/file.txt')
      await rename(join(h.cwd, 'dir'), join(h.root, 'external-directory'))
      await writeFile(join(h.root, 'external-directory', '.gitattributes'), '*.txt filter=missing\n')
      await symlink(join(h.root, 'external-directory'), join(h.cwd, 'dir'), 'dir')
    })
    it('refuses the link before asking Git for attributes', async () => {
      const spawn = vi.spyOn(h.ctx.subprocess, 'spawn')
      spawn.mockClear()
      await expect(h.status()).rejects.toThrow('REPOSITORY_UNSUPPORTED_PATH')
      expect(spawn.mock.calls.some(([spec]) => spec.argv.includes('check-attr'))).toBe(false)
    })
  })

  describe('permits empty filters and suppresses a real repository fsmonitor command on every read', () => {
    let h: Awaited<ReturnType<typeof harness>>, marker: string
    beforeEach(async () => {
      h = await harness()
      await commit(h)
      await writeFile(join(h.cwd, 'same.txt'), 'changed\n')
      const script = join(h.root, 'fsmonitor.mjs')
      marker = join(h.root, 'fsmonitor-marker')
      await writeFile(script, 'import {writeFileSync} from "node:fs";writeFileSync(process.argv[2],"executed")')
      const command = [process.execPath, script, marker].map(value => JSON.stringify(value)).join(' ')
      await h.ok('config', 'core.fsmonitor', command)
      await h.ok('config', 'filter.empty.clean', '')
      await h.ok('config', 'filter.empty.process', '')
      await h.git('status', '--porcelain=v2')
      expect(await readFile(marker, 'utf8')).toBe('executed')
      await rm(marker)
    })
    it.each(['inspect', 'status', 'diff'])('suppresses fsmonitor during %s', async (operation) => {
      if (operation === 'inspect') expect((await h.inspect()).branch).toBe('main')
      else if (operation === 'status') expect((await h.status()).unstaged).toMatchObject([{ path: 'same.txt' }])
      else expect((await h.diff('same.txt', 'unstaged')).text).toContain('+changed')
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  describe('disables external attribute and ignore sources without reading their symlinks', () => {
    let h: Awaited<ReturnType<typeof harness>>, attributes: string
    beforeEach(async () => {
      h = await harness()
      attributes = join(h.root, 'outside-attributes')
      const excludes = join(h.root, 'outside-excludes')
      await writeFile(attributes, '*.bin diff\n')
      await writeFile(excludes, 'new.bin\n')
      await h.ok('config', 'core.attributesFile', attributes)
      await h.ok('config', 'core.excludesFile', excludes)
      await writeFile(join(h.cwd, 'new.bin'), Buffer.from([0, 1, 2]))
    })
    it('reports a binary file hidden by external ignore rules', async () => {
      expect((await h.status()).untracked).toMatchObject([{ path: 'new.bin' }])
    })
    it('ignores the external diff attribute', async () => {
      expect(await h.diff('new.bin', 'untracked')).toMatchObject({ binary: true, text: '' })
    })
    it('ignores external attributes reached through a symlink', async () => {
      await symlink(attributes, join(h.cwd, '.gitattributes'))
      expect(await h.diff('new.bin', 'untracked')).toMatchObject({ binary: true, text: '' })
    })
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
    const clock = deadlineClock(80)
    const original = h.ctx.subprocess.spawn.bind(h.ctx.subprocess)
    vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce(spec => original({ ...spec,
      argv: [process.execPath, '-e', 'process.kill(process.pid,"SIGTERM")'] }))
    await expect(h.status()).rejects.toThrow('REPOSITORY_PROCESS_FAILED')
    vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce(spec => original({ ...spec,
      argv: [process.execPath, '-e', 'process.stdout.write(Buffer.from([255]))'] }))
    await expect(h.status()).rejects.toThrow('REPOSITORY_UNSUPPORTED_ENCODING')
    const ready = Promise.withResolvers<undefined>()
    vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce((spec) => {
      const handle = original({ ...spec, argv: [process.execPath, '-e',
        'process.on("SIGTERM",()=>process.exit(0));process.stdout.write("ready");setInterval(()=>{},1000)'] })
      handle.stdout!.once('data', () => { ready.resolve(undefined) })
      return handle
    })
    const pending = h.status()
    const rejection = expect(pending).rejects.toThrow('REPOSITORY_TIMEOUT')
    await ready.promise
    clock.expire()
    await rejection
  })

  it.each([
    ['config framing', '--list', 'core.repositoryformatversion\n0', 'REPOSITORY_INVALID_CONFIG_OUTPUT', 0],
    ['missing repository', '--show-toplevel', '', 'REPOSITORY_NOT_FOUND', 128],
    ['outside root', '--show-toplevel', '/outside\n', 'REPOSITORY_OUTSIDE_WORKSPACE', 0],
    ['root framing', '--show-toplevel', 'missing-newline', 'REPOSITORY_INVALID_OUTPUT', 0],
    ['empty root', '--show-toplevel', '\n', 'REPOSITORY_INVALID_OUTPUT', 0],
    ['inventory framing', 'ls-files', 'missing-nul', 'REPOSITORY_INVALID_OUTPUT', 0],
    ['attribute framing', 'check-attr', 'missing-nul', 'REPOSITORY_INVALID_OUTPUT', 0],
    ['attribute count', 'check-attr', 'path\0filter\0unspecified\0', 'REPOSITORY_INVALID_OUTPUT', 0],
    ['remote framing', '--get-regexp', 'remote.origin.url\nssh://example.invalid/private', 'REPOSITORY_INVALID_REMOTES', 0],
    ['remote key', '--get-regexp', 'wrong.key\nssh://example.invalid/private\0', 'REPOSITORY_INVALID_REMOTES', 0],
    ['remote separator', '--get-regexp', 'remote.origin.url\0', 'REPOSITORY_INVALID_REMOTES', 0],
  ] as const)('refuses complete-command output with invalid %s', async (_name, command, text, error, code) => {
    const h = await harness()
    replyOnce(h, argv => argv.includes(command), text, code)
    await expect(h.inspect()).rejects.toThrow(error)
  })

  it.each(['path', 'attribute'])('refuses mismatched %s in attribute responses', async (field) => {
    const h = await harness()
    await writeFile(join(h.cwd, 'file.txt'), 'new')
    const text = field === 'path' ? 'other.txt\0filter\0unspecified\0' : 'file.txt\0other\0unspecified\0'
    replyOnce(h, argv => argv.includes('check-attr'), text)
    await expect(h.status()).rejects.toThrow('REPOSITORY_INVALID_OUTPUT')
  })

  for (const source of ['inventory', 'remotes']) {
    describe('bounds ' + source + ' that grow after local config validation', () => {
      let h: Awaited<ReturnType<typeof harness>>
      beforeEach(async () => {
        h = await harness({ maxItems: 4 })
        await writeFile(join(h.cwd, '.git/config'), '[core]\nrepositoryformatversion=0\n')
        if (source === 'inventory') {
          for (let index = 0; index < 5; index++) await writeFile(join(h.cwd, `file-${index}`), 'new')
        } else {
          const text = Array.from({ length: 5 }, (_, index) => `remote.remote${index}.url\nssh://example.invalid/private\0`).join('')
          replyOnce(h, argv => argv.includes('--get-regexp'), text)
        }
      })
      it('refuses the complete command output above the item limit', async () => {
        await expect(source === 'inventory' ? h.status() : h.inspect()).rejects.toThrow('REPOSITORY_ITEM_LIMIT')
      })
    })
  }

  describe('accepts valueless local config records without consulting host configuration', () => {
    let h: Awaited<ReturnType<typeof harness>>
    beforeEach(async () => {
      h = await harness()
      await writeFile(join(h.cwd, '.git/config'), '[core]\nrepositoryformatversion=0\n[feature]\nflag\n')
    })
    it('accepts the valueless flag', async () => {
      expect(await h.inspect()).toMatchObject({ branch: 'main', head: null })
    })
  })

  it('refuses invalid diff requests', async () => {
    const h = await harness()
    await expect(h.diff('', 'unstaged')).rejects.toThrow('REPOSITORY_INVALID_REQUEST')
  })
  describe('refuses staged gitlink previews', () => {
    let h: Awaited<ReturnType<typeof harness>>
    beforeEach(async () => {
      h = await harness()
      await commit(h)
      const head = (await h.ok('rev-parse', 'HEAD')).trim()
      await h.ok('update-index', '--add', '--cacheinfo', '160000', head, 'module')
      // Git suppresses gitlinks under ignore-submodules=all; decoding still refuses a returned submodule record.
      replyOnce(h, argv => argv.includes('status'), `1 A. S... 000000 160000 000000 ${head} ${head} module\0`)
    })
    it('refuses a returned staged submodule record', async () => {
      await expect(h.diff('module', 'staged')).rejects.toThrow('REPOSITORY_UNSUPPORTED_SUBMODULE')
    })
  })

  it.each(['HEAD', 'config'])('refuses missing %s after metadata enumeration', async (name) => {
    const h = await harness()
    await rm(join(h.cwd, '.git', name))
    const spawn = vi.spyOn(h.ctx.subprocess, 'spawn')
    spawn.mockClear()
    await expect(h.inspect()).rejects.toThrow('REPOSITORY_NOT_FOUND')
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each([Buffer.from([255]), Buffer.from('not-a-reference\n')])('refuses invalid metadata bytes %j before Git', async (bytes) => {
    const h = await harness()
    await writeFile(join(h.cwd, '.git/HEAD'), bytes)
    const spawn = vi.spyOn(h.ctx.subprocess, 'spawn')
    spawn.mockClear()
    await expect(h.inspect()).rejects.toThrow('REPOSITORY_UNSUPPORTED_METADATA')
    expect(spawn).not.toHaveBeenCalled()
  })

  describe('bounds reference content reads and sanitizes provider read failures', () => {
    let h: Awaited<ReturnType<typeof harness>>
    describe('oversized reference', () => {
      beforeEach(async () => {
        h = await harness({ maxMetadataBytes: 65536 })
        await writeFile(join(h.cwd, '.git/HEAD'), '0'.repeat(131072))
      })
      it('bounds the bytes read by the real provider', async () => {
        await expect(h.inspect()).rejects.toThrow('REPOSITORY_METADATA_BYTE_LIMIT')
      })
    })
    describe('removed reference', () => {
      beforeEach(async () => {
        h = await harness()
        const read = h.ctx.fs.readBytes.bind(h.ctx.fs)
        vi.spyOn(h.ctx.fs, 'readBytes').mockImplementationOnce(async (target, signal, maxBytes) => {
          await rm(h.ctx.fs.processPath(target))
          return read(target, signal, maxBytes)
        })
      })
      it('sanitizes a real provider read after the file disappears', async () => {
        await expect(h.inspect()).rejects.toThrow('REPOSITORY_IO_FAILED')
      })
    })
    describe('unavailable provider', () => {
      beforeEach(async () => {
        h = await harness()
        vi.spyOn(h.ctx.fs, 'readBytes').mockRejectedValueOnce(new Error('private provider diagnostic'))
      })
      it('sanitizes an untyped provider failure', async () => {
        await expect(h.inspect()).rejects.toThrow('REPOSITORY_IO_FAILED')
      })
    })
  })

  it.each(['inside', 'outside'])('refuses metadata replaced with an %s link after lstat', async (destination) => {
    const h = await harness()
    const path = join(h.cwd, '.git/config')
    const target = destination === 'inside' ? join(h.cwd, '.git/replacement') : join(h.root, 'replacement')
    await writeFile(target, '')
    const resolve = h.ctx.fs.resolve.bind(h.ctx.fs)
    vi.spyOn(h.ctx.fs, 'resolve').mockImplementation(async (name, options) => {
      if (name === path) {
        await rm(path)
        await symlink(target, path)
      }
      return resolve(name, options)
    })
    const spawn = vi.spyOn(h.ctx.subprocess, 'spawn')
    spawn.mockClear()
    await expect(h.inspect()).rejects.toThrow('REPOSITORY_UNSUPPORTED_METADATA')
    expect(spawn).not.toHaveBeenCalled()
  })

  describe('refuses a diff path replaced with an escaping link after lstat', () => {
    let h: Awaited<ReturnType<typeof harness>>
    beforeEach(async () => {
      h = await harness()
      await writeFile(join(h.cwd, 'victim'), 'new')
      const external = join(h.root, 'external')
      await writeFile(external, 'private')
      const lstat = h.ctx.fs.lstat.bind(h.ctx.fs)
      vi.spyOn(h.ctx.fs, 'lstat').mockImplementation(async (path, options, signal) => {
        const info = await lstat(path, options, signal)
        if (path === 'victim') {
          await rm(join(h.cwd, path))
          await symlink(external, join(h.cwd, path))
        }
        return info
      })
    })
    it('refuses the newly escaping path', async () => {
      await expect(h.diff('victim', 'untracked')).rejects.toThrow('REPOSITORY_INVALID_PATH')
    })
  })

  describe('refuses special-file diff paths reported by the filesystem provider', () => {
    let h: Awaited<ReturnType<typeof harness>>
    beforeEach(async () => {
      h = await harness()
      await writeFile(join(h.cwd, 'special'), 'new')
      const lstat = h.ctx.fs.lstat.bind(h.ctx.fs)
      vi.spyOn(h.ctx.fs, 'lstat').mockImplementation(async (path, options, signal) => {
        const info = await lstat(path, options, signal)
        return path === 'special' && info ? { ...info, type: 'other' } : info
      })
    })
    it('refuses the special file', async () => {
      await expect(h.diff('special', 'untracked')).rejects.toThrow('REPOSITORY_UNSUPPORTED_PATH')
    })
  })

  it.each(['stdin', 'stdout', 'stderr'] as const)('refuses missing requested %s and awaits the managed child', async (stream) => {
    const h = await harness()
    let handle: ReturnType<typeof h.spawn> | undefined
    vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementation((spec) => {
      if (handle || (stream === 'stdin' && !spec.argv.includes('check-attr'))) return h.spawn(spec)
      handle = h.spawn({ ...spec, stdio: { ...spec.stdio,
        ...stream === 'stdin' ? { stdin: 'ignore' } : { [stream]: { maxBytes: 1024 } },
      } })
      return handle
    })
    await expect(h.status()).rejects.toThrow('REPOSITORY_PROCESS_FAILED')
    expect(await handle!.waitForExit()).toBe(true)
  })

  describe('accepts complete string chunks from a process stream', () => {
    let h: Awaited<ReturnType<typeof harness>>
    beforeEach(async () => { h = await harness() })
    it('accepts UTF-8 string chunks', async () => {
      vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce((spec) => {
        const handle = h.spawn(spec)
        handle.stdout!.setEncoding('utf8')
        return handle
      })
      expect(await h.inspect()).toMatchObject({ branch: 'main', head: null })
    })
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

  describe('settles cancellation, timeout and disposal after managed process trees stop', () => {
    let h: Awaited<ReturnType<typeof harness>>, clock: ReturnType<typeof deadlineClock>
    let originalSpawn: Awaited<ReturnType<typeof harness>>['spawn'], handles: ReturnType<typeof originalSpawn>[]
    beforeEach(async () => {
      h = await harness({ timeoutMs: 100, graceMs: 30 })
      clock = deadlineClock(100)
      originalSpawn = h.ctx.subprocess.spawn.bind(h.ctx.subprocess)
      handles = []
    })
    it('settles timeout after the ready managed tree stops', async () => {
      const processReady = Promise.withResolvers<undefined>()
      vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce((spec: SubprocessSpawnSpec) => {
        const handle = originalSpawn({ ...spec, argv: [process.execPath, '-e', 'process.stdout.write("ready");setInterval(()=>{},1000)'] })
        handles.push(handle)
        handle.stdout!.once('data', () => { processReady.resolve(undefined) })
        return handle
      })
      const timedOut = h.status()
      const timeoutRejection = expect(timedOut).rejects.toThrow('REPOSITORY_TIMEOUT')
      await processReady.promise
      clock.expire()
      await timeoutRejection
      expect(await handles[0]?.waitForExit()).toBe(true)
    })
    it('settles cancellation after the managed tree stops', async () => {
      const controller = new AbortController()
      vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementationOnce((spec) => {
        const handle = originalSpawn({ ...spec, argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'] })
        handles.push(handle)
        controller.abort()
        return handle
      })
      const cancelled = h.ctx.repository.status({ workspaceId: h.workspaceId }, controller.signal)
      await expect(cancelled).rejects.toThrow('REPOSITORY_CANCELLED')
    })
    it('settles disposal while a managed child is alive', async () => {
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
})

it('refuses incomplete NUL records, malformed status and incomplete rename pairs', () => {
  expect(() => parsePorcelain('? file', 10)).toThrow('REPOSITORY_INVALID_STATUS')
  expect(() => parsePorcelain('2 R. N... 100644 100644 100644 a b R100 new\0', 10)).toThrow('REPOSITORY_INVALID_STATUS')
  expect(() => parsePorcelain('garbage\0', 10)).toThrow('REPOSITORY_INVALID_STATUS')
})
