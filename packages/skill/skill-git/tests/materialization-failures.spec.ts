import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { GitSkillService } from '../src/index.ts'
import { safeJoin } from '../src/cache-path.ts'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn(),
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: vi.fn(actual.writeFile) }
})
const roots: string[] = []
const services: GitSkillService[] = []
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

async function fixture(options: { cloneFails?: boolean; mismatchedCommit?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arx-skill-failure-')); roots.push(root)
  const commit = 'a'.repeat(40)
  const repository = options.cloneFails === true ? 'https://github.com/example/skills' : join(root, 'repository')
  const cacheDir = join(root, 'cache')
  vi.mocked(spawn).mockImplementation((file, args) => {
    const argv = args
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true),
    })
    setImmediate(() => {
      void (async () => {
        if (file === 'gh' || argv[0] === 'clone') {
          if (file === 'git' && options.cloneFails === true) { child.emit('close', 1); return }
          const mirror = argv[3]!
          await mkdir(mirror, { recursive: true })
          await writeFile(join(mirror, 'HEAD'), commit)
        } else if (argv[0] === 'rev-parse') {
          child.stdout.write(options.mismatchedCommit === true ? 'b'.repeat(40) : commit)
        } else if (argv[0] === 'ls-tree') {
          child.stdout.write('100644 blob ' + 'c'.repeat(40) + '\tskills/SKILL.md\0')
        } else if (argv[0] === 'cat-file') {
          child.stdout.write('# Skill\n')
        } else throw new Error('Unexpected mocked Git command: ' + argv.join(' '))
        child.emit('close', 0)
      })().catch((error: unknown) => { child.emit('error', error); child.emit('close', 1) })
    })
    return child as unknown as ReturnType<typeof spawn>
  })
  const service = new GitSkillService({ cacheDir }); services.push(service)
  return { root, repository, cacheDir, commit, service, request: { repository, commit, paths: ['skills/SKILL.md'] } }
}

it('accepts cache-contained paths and rejects parent traversal and absolute siblings', () => {
  const root = resolve(tmpdir(), 'arx-cache')
  expect(safeJoin(root, '')).toBe(root)
  expect(safeJoin(root, 'skills/SKILL.md')).toBe(join(root, 'skills', 'SKILL.md'))
  for (const path of ['..', '../outside/file', join(dirname(root), 'other'), sep + 'outside']) {
    expect(() => safeJoin(root, path)).toThrow('escapes its cache root')
  }
})

it('reuses verified directory materializations and an existing repository mirror across services', async () => {
  const f = await fixture()
  const selection = { repository: f.repository, commit: f.commit, selectedDirs: ['skills'] }
  const first = await f.service.materializeDirectories(selection)
  expect(await f.service.materializeDirectories(selection)).toEqual(first)
  const next = new GitSkillService({ cacheDir: f.cacheDir }); services.push(next)
  expect((await next.snapshot(f.request))[0]?.content).toBe('# Skill\n')
  expect(vi.mocked(spawn).mock.calls.filter(call => call[1]?.[0] === 'clone')).toHaveLength(1)
})

it('rejects Git resolving a different commit before accepting any files', async () => {
  const f = await fixture({ mismatchedCommit: true })
  await expect(f.service.snapshot(f.request)).rejects.toThrow('requested commit is unavailable')
  expect(vi.mocked(spawn).mock.calls.some(call => call[1]?.[0] === 'cat-file')).toBe(false)
})

it('uses the authenticated GitHub CLI fallback after a direct GitHub clone fails', async () => {
  const f = await fixture({ cloneFails: true })
  expect((await f.service.snapshot(f.request))[0]?.content).toBe('# Skill\n')
  expect(spawn).toHaveBeenCalledWith('gh', expect.arrayContaining(['repo', 'clone', f.repository]), expect.objectContaining({ shell: false }))
})

it('removes the partial materialization and preserves the filesystem failure', async () => {
  const f = await fixture()
  const write = vi.mocked(writeFile).getMockImplementation()!
  const failure = new Error('disk quota exceeded')
  vi.mocked(writeFile).mockImplementationOnce(write).mockRejectedValueOnce(failure)
  await expect(f.service.snapshot(f.request)).rejects.toBe(failure)
  expect(await readdir(join(f.cacheDir, 'materialized'))).toEqual([])
})
