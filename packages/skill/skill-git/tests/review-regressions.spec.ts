import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import SkillRegistry from '@arx-ai/arx-skill'
import * as SkillGit from '@arx-ai/arx-skill-git'
const run = promisify(execFile)
const contexts: Context[] = []
const roots: string[] = []
const services: SkillGit.GitSkillService[] = []
afterEach(async () => {
  await Promise.allSettled(services.splice(0).map(service => service.dispose()))
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.allSettled(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function root() { const value = await mkdtemp(join(tmpdir(), 'arx-independent-review-')); roots.push(value); return value }
it('review: skill-git composes through the Loader namespace', async () => {
  const directory = await root()
  const configPath = join(directory, 'cordis.yml')
  await writeFile(configPath, "- name: '@arx-ai/arx-skill-git'\n  config:\n    providerName: review-git\n")
  const ctx = new Context(); contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import() { return SkillGit } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  await ctx.plugin(SkillRegistry)
  await ctx.loader.await()
  expect(ctx.get('skillGit')).toBeDefined()
  expect(await ctx.skills.list({ cwd: directory })).toEqual([])
})
it('review: an existing mirror can resolve a newly pinned commit', async () => {
  const directory = await root()
  const repo = join(directory, 'source'); await mkdir(repo)
  await run('git', ['init', repo])
  await run('git', ['-C', repo, 'config', 'user.email', 'review@example.test'])
  await run('git', ['-C', repo, 'config', 'user.name', 'Independent Review'])
  await writeFile(join(repo, 'SKILL.md'), 'First skill')
  await run('git', ['-C', repo, 'add', '.']); await run('git', ['-C', repo, 'commit', '-m', 'first'])
  const first = (await run('git', ['-C', repo, 'rev-parse', 'HEAD'])).stdout.trim()
  const service = new SkillGit.GitSkillService({ cacheDir: join(directory, 'cache') }); services.push(service)
  await service.snapshot({ repository: repo, commit: first, paths: ['SKILL.md'] })
  const cancelled = new AbortController(); cancelled.abort(new Error('cancelled cache read'))
  await expect(service.snapshot({ repository: repo, commit: first, paths: ['SKILL.md'] }, cancelled.signal)).rejects.toThrow('cancelled cache read')
  await writeFile(join(repo, 'SKILL.md'), 'Second skill')
  await run('git', ['-C', repo, 'add', '.']); await run('git', ['-C', repo, 'commit', '-m', 'second'])
  const second = (await run('git', ['-C', repo, 'rev-parse', 'HEAD'])).stdout.trim()
  expect((await service.snapshot({ repository: repo, commit: second, paths: ['SKILL.md'] }))[0]?.content).toBe('Second skill')
}, 30_000)
