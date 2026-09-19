import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import SkillRegistry from '@arx-ai/arx-skill'
import * as SkillGit from '../src/index.ts'

const run = promisify(execFile)
const roots: string[] = []
const services: SkillGit.GitSkillService[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const service of services.splice(0)) await service.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})
function service(config: SkillGit.Config = {}) { const result = new SkillGit.GitSkillService(config); services.push(result); return result }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'arx-skill-contract-')); roots.push(root)
  const repository = join(root, 'repo'); await mkdir(repository)
  const git = async (...args: string[]) => (await run('git', ['-C', repository, ...args])).stdout.trim()
  await git('init')
  await git('config', 'user.email', 'contracts@example.test'); await git('config', 'user.name', 'Skill contracts')
  await mkdir(join(repository, 'skills'))
  await writeFile(join(repository, 'skills/One.md'), 'First skill content')
  await writeFile(join(repository, 'skills/Two.md'), 'Second skill content')
  await git('add', '.'); await git('commit', '-m', 'Initial')
  const commit = await git('rev-parse', 'HEAD')
  const cacheDir = join(root, 'cache')
  const request = { repository, commit, paths: ['skills/One.md'] }
  const digest = (value: string) => createHash('sha256').update(value).digest('hex')
  const key = digest(JSON.stringify({ repository, commit, selectedPaths: request.paths, exactFiles: true }))
  const materialized = join(cacheDir, 'materialized', key)
  return { root, repository, git, commit, cacheDir, request, materialized }
}
it('rejects unsafe caller configuration and path variants before starting Git', async () => {
  for (const value of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => service({ maxFiles: value })).toThrow('positive safe integer')
    expect(() => service({ maxBytes: value })).toThrow('positive safe integer')
  }
  const valid = service()
  const request = { repository: process.cwd(), commit: 'a'.repeat(40), paths: ['SKILL.md'] }
  for (const repository of ['relative/repo', 'https://example.com/repo', 'http://github.com/o/r', '--upload-pack=bad']) await expect(valid.snapshot({ ...request, repository })).rejects.toThrow('absolute local path')
  for (const path of ['', '/', 'C:/outside', '../outside', 'a//b', 'a/./b', 'a/../b', '.git/config']) await expect(valid.snapshot({ ...request, paths: [path] })).rejects.toThrow()
  await expect(valid.snapshot({ ...request, paths: [] })).rejects.toThrow('at least one')
  await expect(valid.snapshot({ ...request, commit: 'HEAD' })).rejects.toThrow('40-hex')
  for (const repository of ['https://github.com/o/r/', 'git@github.com:o/r.git', 'ssh://git@github.com/o/r']) {
    expect(service({ projects: [{ cwd: '.', sources: [{ repository, commit: request.commit, selectedDirs: ['b', './a/', 'a'] }] }] }).config.projects[0]?.sources[0]?.selectedDirs).toEqual(['a', 'b'])
  }
  await valid.dispose()
  await expect(valid.snapshot(request)).rejects.toThrow('disposed')
})

// Each malformed manifest forces several real Git processes; allow Windows coverage overhead.
it('rebuilds malformed cache manifests and refuses exact-file cache mismatches', async () => {
  const fx = await fixture()
  const selected = service({ cacheDir: fx.cacheDir, maxFiles: 2 })
  const original = await selected.snapshot(fx.request)
  const manifestPath = join(fx.materialized, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: number; repository: string; commit: string; selectedPaths: unknown; files: Record<string, unknown>[] }
  const corrupt: unknown[] = [
    null, [], 'text', { ...manifest, version: 2 }, { ...manifest, repository: 'elsewhere' },
    { ...manifest, commit: 'bad' }, { ...manifest, selectedPaths: false },
    { ...manifest, selectedPaths: [4] }, { ...manifest, selectedPaths: ['missing'] },
    { ...manifest, files: false }, { ...manifest, files: Array.from({ length: 3 }, () => manifest.files[0]) },
    ...[null, [], 'text', { ...manifest.files[0], path: 4 }, { ...manifest.files[0], bytes: 0.5 },
      { ...manifest.files[0], bytes: -1 }, { ...manifest.files[0], contentHash: false },
      { ...manifest.files[0], path: '../outside' }, { ...manifest.files[0], bytes: 1 },
      { ...manifest.files[0], contentHash: 'sha256:wrong' }].map(file => ({ ...manifest, files: [file] })),
  ]
  for (const value of corrupt) {
    await writeFile(manifestPath, JSON.stringify(value))
    expect((await selected.snapshot(fx.request))[0]?.contentHash).toBe(original[0]?.contentHash)
  }
  await writeFile(manifestPath, JSON.stringify({ ...manifest, files: [] }))
  await expect(selected.snapshot(fx.request)).rejects.toThrow('exact regular files')
  await writeFile(manifestPath, JSON.stringify(manifest))
  await rm(join(fx.materialized, 'skills/One.md'))
  await mkdir(join(fx.materialized, 'skills/One.md'))
  expect((await selected.snapshot(fx.request))[0]?.content).toBe(original[0]?.content)
  await writeFile(manifestPath, '{bad json')
  expect((await selected.snapshot(fx.request))[0]?.content).toBe(original[0]?.content)
}, 120_000)

it('bounds combined content, raw command output, and rejects non-file or missing selections', async () => {
  const fx = await fixture()
  await expect(service({ cacheDir: fx.cacheDir, maxBytes: 30 }).snapshot({ ...fx.request, paths: ['skills/One.md', 'skills/Two.md'] })).rejects.toThrow('byte limit')
  await expect(service({ cacheDir: join(fx.root, 'tiny'), maxBytes: 1 }).snapshot(fx.request)).rejects.toThrow('output exceeds')
  const selected = service({ cacheDir: join(fx.root, 'regular') })
  await expect(selected.snapshot({ ...fx.request, paths: ['missing'] })).rejects.toThrow('no files')
  await expect(selected.snapshot({ ...fx.request, paths: ['skills'] })).rejects.toThrow('exact regular files')
  await expect(selected.snapshot({ ...fx.request, paths: ['skills/One.md', 'missing'] })).rejects.toThrow('exact regular files')
  const object = await fx.git('rev-parse', fx.commit + ':skills/One.md')
  await fx.git('update-index', '--add', '--cacheinfo', '120000,' + object + ',link.md')
  await fx.git('commit', '-m', 'Symlink entry')
  const symlinkCommit = await fx.git('rev-parse', 'HEAD')
  await expect(selected.snapshot({ ...fx.request, commit: symlinkCommit, paths: ['link.md'] })).rejects.toThrow('symlink or non-regular')
  await fx.git('update-index', '--add', '--cacheinfo', '160000,' + fx.commit + ',module')
  await fx.git('commit', '-m', 'Gitlink entry')
  await expect(selected.materializeDirectories({ repository: fx.repository, commit: await fx.git('rev-parse', 'HEAD'), selectedDirs: ['module'] })).rejects.toThrow('unsupported entry')
  await fx.git('update-index', '--add', '--cacheinfo', '100644,' + object + ',Case.md')
  await fx.git('update-index', '--add', '--cacheinfo', '100644,' + object + ',case.md')
  await fx.git('commit', '-m', 'Case collision')
  await expect(selected.snapshot({ ...fx.request, commit: await fx.git('rev-parse', 'HEAD'), paths: ['Case.md', 'case.md'] })).rejects.toThrow('case-colliding')
}, 90_000)

it('shares materialization ownership while one caller cancels and retries after a failed repository', async () => {
  const fx = await fixture()
  const selected = service({ cacheDir: fx.cacheDir })
  const controller = new AbortController()
  const cancelled = selected.snapshot(fx.request, controller.signal)
  const survivor = selected.snapshot(fx.request)
  controller.abort('caller cancelled')
  await expect(cancelled).rejects.toThrow('cancelled')
  expect((await survivor)[0]?.content).toBe('First skill content')
  const missing = { ...fx.request, repository: join(fx.root, 'later') }
  const first = selected.snapshot(missing, new AbortController().signal)
  await expect(first).rejects.toThrow('repository operation failed')
  await run('git', ['clone', fx.repository, missing.repository])
  expect((await selected.snapshot(missing))[0]?.content).toBe('First skill content')
  const disposed = service({ cacheDir: join(fx.root, 'shutdown') })
  const operation = disposed.snapshot(fx.request)
  const rejection = expect(operation).rejects.toThrow()
  await disposed.dispose()
  await rejection
  expect(disposed.dispose()).toBe(disposed.dispose())
}, 30_000)

it('returns empty catalogs without a matching workspace and composes defaults through the provider lifetime', async () => {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SkillRegistry)
  SkillGit.apply(ctx)
  expect(await ctx.skills.list()).toEqual([])
  expect(await ctx.skills.list({ cwd: process.cwd() })).toEqual([])
})
