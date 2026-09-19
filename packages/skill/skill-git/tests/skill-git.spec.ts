import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import SkillRegistry from '@arx-ai/arx-skill'
import * as SkillGit from '../src/index.ts'

const run = promisify(execFile)
const contexts: Context[] = []
const services: SkillGit.GitSkillService[] = []
const roots: string[] = []

afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose()
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.allSettled(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; repo: string; cache: string; en: string; pt: string; commit: string }> {
  const root = await mkdtemp(join(tmpdir(), 'arx-skill-git-'))
  roots.push(root)
  const repo = join(root, 'source')
  const cache = join(root, 'cache')
  const en = join(root, 'workspace-en')
  const pt = join(root, 'workspace-pt')
  await mkdir(join(repo, 'catalog/en/english-route'), { recursive: true })
  await mkdir(join(repo, 'catalog/pt/rota-portuguesa'), { recursive: true })
  await mkdir(en)
  await mkdir(pt)
  await writeFile(join(repo, 'catalog/en/english-route/SKILL.md'), [
    '---', 'name: english-route', 'description: Route an English request.', '---', '', 'Use the English route.', '',
  ].join('\n'))
  await writeFile(join(repo, 'catalog/pt/rota-portuguesa/SKILL.md'), [
    '---', 'name: rota-portuguesa', 'description: Encaminhe um pedido em português.', '---', '', 'Use a rota em português.', '',
  ].join('\n'))
  await run('git', ['init', repo])
  await run('git', ['-C', repo, 'config', 'user.email', 'skill-git@example.test'])
  await run('git', ['-C', repo, 'config', 'user.name', 'Skill Git Test'])
  await run('git', ['-C', repo, 'add', '.'])
  await run('git', ['-C', repo, 'commit', '-m', 'initial skills'])
  const { stdout } = await run('git', ['-C', repo, 'rev-parse', 'HEAD'])
  return { root, repo, cache, en, pt, commit: stdout.trim() }
}

describe('revision-pinned Git skill provider', () => {
  it('routes selected English and Portuguese catalogs by cwd and returns exact provenance', async () => {
    const fx = await fixture()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillGit, {
      cacheDir: fx.cache,
      projects: [
        { cwd: fx.en, sources: [{ repository: fx.repo, commit: fx.commit, selectedDirs: ['catalog/en'] }] },
        { cwd: fx.pt, sources: [{ repository: fx.repo, commit: fx.commit, selectedDirs: ['catalog/pt'] }] },
      ],
    })

    expect((await ctx.skills.list({ cwd: fx.en })).map(skill => skill.name)).toEqual(['english-route'])
    expect((await ctx.skills.list({ cwd: fx.pt })).map(skill => skill.name)).toEqual(['rota-portuguesa'])
    expect((await ctx.skills.get('english-route', { cwd: fx.en }))?.content).toContain('English route')
    expect(await ctx.skills.get('rota-portuguesa', { cwd: fx.en })).toBeUndefined()

    const snapshots = await ctx.skillGit.snapshot({
      repository: fx.repo,
      commit: fx.commit,
      paths: ['catalog/en/english-route/SKILL.md'],
    })
    expect(snapshots).toMatchObject([{
      repository: fx.repo,
      commit: fx.commit,
      path: 'catalog/en/english-route/SKILL.md',
    }])
    expect(snapshots[0]?.content).toContain('Use the English route.')
    expect(snapshots[0]?.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)

    await writeFile(join(fx.repo, 'catalog/en/english-route/SKILL.md'), 'changed after the pinned commit')
    await run('git', ['-C', fx.repo, 'add', '.'])
    await run('git', ['-C', fx.repo, 'commit', '-m', 'move branch'])
    expect((await ctx.skillGit.snapshot({
      repository: fx.repo,
      commit: fx.commit,
      paths: ['catalog/en/english-route/SKILL.md'],
    }))[0]?.content).toContain('Use the English route.')
  }, 30_000)

  it('revalidates cache hashes, works offline by exact SHA, and rejects unsafe or over-budget selections', async () => {
    const fx = await fixture()
    const service = new SkillGit.GitSkillService({ cacheDir: fx.cache, maxFiles: 1, maxBytes: 100_000 })
    const request = {
      repository: fx.repo,
      commit: fx.commit,
      paths: ['catalog/en/english-route/SKILL.md'],
    }
    services.push(service)
    const initial = await service.snapshot(request)
    const cachedFiles = await readdir(join(fx.cache, 'materialized'), { recursive: true })
    const cachedSkill = cachedFiles.find(path => path.replaceAll('\\', '/').endsWith('catalog/en/english-route/SKILL.md'))
    if (cachedSkill === undefined) throw new Error('expected cached skill')
    await writeFile(join(fx.cache, 'materialized', cachedSkill), 'tampered')
    expect((await service.snapshot(request))[0]?.contentHash).toBe(initial[0]?.contentHash)
    await service.dispose()

    const offlineRepo = join(fx.root, 'source-offline')
    await rename(fx.repo, offlineRepo)
    const offline = new SkillGit.GitSkillService({ cacheDir: fx.cache })
    services.push(offline)
    expect((await offline.snapshot(request))[0]?.content).toContain('Use the English route.')
    await expect(offline.snapshot({ ...request, commit: 'main' })).rejects.toThrow('exact 40-hex')
    await expect(offline.snapshot({ ...request, paths: ['../secret'] })).rejects.toThrow('forbidden segment')
    await offline.dispose()

    const bounded = new SkillGit.GitSkillService({ cacheDir: join(fx.root, 'bounded-cache'), maxFiles: 1 })
    services.push(bounded)
    await expect(bounded.snapshot({
      repository: offlineRepo,
      commit: fx.commit,
      paths: [
        'catalog/en/english-route/SKILL.md',
        'catalog/pt/rota-portuguesa/SKILL.md',
      ],
    })).rejects.toThrow('file count exceeds')
    await bounded.dispose()
  }, 30_000)
})
