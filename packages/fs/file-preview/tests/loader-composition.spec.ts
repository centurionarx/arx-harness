import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import AgentLoop from '@arx-ai/arx-agent-loop'
import { mountAgentLoopTestDependencies } from '@arx-ai/arx-agent-loop-testkit'
import { LocalFileSystem } from '@arx-ai/arx-fs-local'
import { SessionId } from '@arx-ai/arx-session'
import { expect, it } from 'vitest'
import * as Preview from '../src/index.ts'

it('loads the shipped class plugin through YAML and reads using the live Agent without transcript mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arx-preview-loader-'))
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(LocalFileSystem, { cwd: root })
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, "- name: '@arx-ai/arx-file-preview'\n  config:\n    maxBytes: 128\n")
    await writeFile(join(root, 'report.md'), '# Composed preview')
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier !== '@arx-ai/arx-file-preview') throw new Error('Unexpected Loader import: ' + specifier)
        return Preview
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    const owner = ctx.agentLoop.create(SessionId('preview-loader'), {}, { cwd: root })
    const before = [...owner.session.events]
    const result = await ctx.filePreviews.read(owner, 'report.md', new AbortController().signal)
    expect(result).toMatchObject({ path: 'report.md', kind: 'markdown', content: '# Composed preview' })
    expect(owner.session.events).toEqual(before)
    await writeFile(join(root, 'large.txt'), 'x'.repeat(129))
    await expect(ctx.filePreviews.read(owner, 'large.txt', new AbortController().signal)).rejects.toThrow('byte limit')
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
