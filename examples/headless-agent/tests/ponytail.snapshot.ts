/** Keyless Loader transcript for the installed, model-independent Ponytail skills. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeSessionSnapshot } from '@arx-ai/arx-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@arx-ai/arx-loader-smoke'
import type { SessionEvent, SessionHeader } from '@arx-ai/arx-session'
import { renderSkillContent } from '@arx-ai/arx-skill'
import type {} from '@arx-ai/arx-tool-skill'

const configPath = fileURLToPath(new URL('./fixtures/skill/ponytail/cordis.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/skill/ponytail/replay.override.json', import.meta.url))
const skillRoot = fileURLToPath(new URL('../../../.agents/skills/', import.meta.url))
const names = ['ponytail', 'ponytail-audit', 'ponytail-debt', 'ponytail-gain', 'ponytail-help', 'ponytail-review']
const task = names.map(name => '/' + name).join(' ') + ' Load all six through the skill tool for validation.'

describe('Ponytail through the headless Loader application', () => {
  it('extracts the installed debt search pattern and distinguishes prefixed comments from prose', async () => {
    const instructions = await readFile(join(skillRoot, 'ponytail-debt', 'SKILL.md'), 'utf8')
    const extracted = /pattern such as `([^`]+)`/.exec(instructions)
    expect(extracted).not.toBeNull()
    const pattern = extracted?.[1]
    if (pattern === undefined) throw new Error('Missing installed debt search pattern')
    const matcher = new RegExp(pattern)
    for (const comment of [
      '// ponytail: global lock, per-account locks if throughput matters',
      '// TODO ponytail: global lock, per-account locks if throughput matters',
      '# FIXME ponytail: global lock, per-account locks if throughput matters',
      '/* XXX: ponytail: global lock, per-account locks if throughput matters */',
    ]) {
      expect(matcher.test(comment), comment).toBe(true)
    }
    expect(matcher.test('ponytail: global lock, per-account locks if throughput matters')).toBe(false)
    const prose = instructions.split('\n').find(line => line.startsWith('Every deliberate ponytail shortcut'))
    expect(prose).toBeDefined()
    if (prose === undefined) throw new Error('Missing installed debt convention prose')
    expect(matcher.test(prose)).toBe(false)
    expect(instructions).toContain('Confirm each match is an actual comment, not a quoted string or example.')
    expect(instructions).toContain('Exclude dependencies, generated output, imported skills, and caches from the report')
  })

  it('publishes six installed skills, loads every body and logs explicit invocations on two keyless routes', async () => {
    const installed = await Promise.all(names.map(async (name) => {
      const raw = await readFile(join(skillRoot, name, 'SKILL.md'), 'utf8')
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw)
      expect(frontmatter, name).not.toBeNull()
      expect(frontmatter![1]).toContain('name: ' + name)
      const content = frontmatter![2]!.trim()
      expect(content).toContain('model-independent instructions, not a Claude Code plugin')
      return { name, content }
    }))
    let firstTranscript: string | undefined
    for (const route of ['a', 'b']) {
      const provider = 'ponytail-provider-' + route
      const model = 'ponytail-model-' + route
      const result = await runLoaderSmoke({
        label: 'Ponytail ' + route + ' headless snapshot',
        tempDirPrefix: 'arx-ponytail-snapshot-',
        binScript,
        libBinScript: binScript,
        configPath,
        binArgs: [configPath, task],
        tsconfigPath,
        env: {
          ARX_SNAPSHOT: 'replay',
          ARX_SNAPSHOT_FILE: fixture,
          ARX_SNAPSHOT_OVERRIDE: fixture,
          ARX_PONYTAIL_SKILL_ROOT: skillRoot,
          ARX_PONYTAIL_PROVIDER: provider,
          ARX_PONYTAIL_MODEL: model,
          ARX_INDEXED_SKILL_ROOT: '',
          ANTHROPIC_API_KEY: '',
          CLAUDE_CODE_OAUTH_TOKEN: '',
          DEEPSEEK_API_KEY: '',
          OPENAI_API_KEY: '',
        },
        prepare: async (cwd) => {
          // Default roots must stay excluded even when they contain valid skills.
          for (const root of ['.arx/skills', '.agents/skills']) {
            const directory = join(cwd, root, 'home-only-sentinel')
            await mkdir(directory, { recursive: true })
            await writeFile(join(directory, 'SKILL.md'), '---\nname: home-only-sentinel\ndescription: Must not enter the catalog.\n---\nHome-only instructions.\n')
          }
        },
        inspect: async (cwd) => {
          const root = join(cwd, '.sessions')
          const files = (await readdir(root, { recursive: true })).filter(path => path.endsWith('.jsonl'))
          expect(files).toHaveLength(1)
          const content = await readFile(join(root, files[0]!), 'utf8')
          const [headerLine, ...eventLines] = content.trim().split('\n')
          const header = JSON.parse(headerLine!) as SessionHeader
          const events = eventLines.map(line => JSON.parse(line) as SessionEvent)
          const messages = events.filter(event => event.type === 'user/message').map(event => event.data)
          const catalogs = messages.filter(message => message.source?.kind === 'skill-catalog')
          expect(catalogs).toHaveLength(1)
          const source = catalogs[0]!.source
          if (source?.kind !== 'skill-catalog') throw new Error('Missing durable skill catalog')
          const ponytailEntries = source.entries.filter(entry => entry.name.startsWith('ponytail'))
          expect(ponytailEntries.map(entry => entry.name)).toEqual(names)
          for (const entry of ponytailEntries) {
            expect(typeof entry.description).toBe('string')
            expect(entry.description.trim().length).toBeGreaterThan(0)
          }
          expect(source.entries.some(entry => entry.name === 'home-only-sentinel')).toBe(false)
          const invocations = messages.filter(message => message.source?.kind === 'skill-invocation')
          expect(invocations.map(message => message.source?.kind === 'skill-invocation' ? message.source.name : '')).toEqual(names)
          const calls = events.filter(event => event.type === 'tool/call')
          expect(calls.map(event => ({ name: event.data.name, args: JSON.parse(event.data.arguments) as unknown })))
            .toEqual(names.map(name => ({ name: 'skill', args: { name } })))
          const results = events.filter(event => event.type === 'tool/result')
          expect(results).toHaveLength(6)
          for (const [index, skill] of installed.entries()) {
            const rendered = renderSkillContent({
              name: skill.name,
              provider: 'filesystem',
              resourceBase: { kind: 'directory', path: join(skillRoot, skill.name) },
              content: skill.content,
            })
            expect(invocations[index]!.content).toEqual([{ type: 'text', text: rendered }])
            const blocks = results[index]!.data.message.content
            expect(blocks).toHaveLength(1)
            const block = blocks[0]
            expect(block.type).toBe('tool-result')
            if (block.type !== 'tool-result') throw new Error('Missing skill tool result')
            expect(block.isError).toBe(false)
            expect(block.toolCallId).toBe('load-' + skill.name)
            expect(block.content).toEqual([{ type: 'text', text: rendered }])
          }
          const contexts = events.filter(event => event.type === 'request/context')
          expect(contexts.length).toBeGreaterThan(0)
          expect(contexts.map(event => event.data)).toEqual(contexts.map(() => ({ provider, model, contextWindow: 128000 })))
          expect(events.filter(event => event.type === 'turn/end').map(event => event.data.reason)).toEqual([{ kind: 'completed' }])
          const normalized = normalizeSessionSnapshot(content, { sessionIds: [header.id], cwd })
            .replaceAll(skillRoot.replace(/[\\/]$/, ''), '{{skillRoot}}')
            .replaceAll(provider, '{{provider}}').replaceAll(model, '{{model}}')
          if (firstTranscript === undefined) {
            firstTranscript = normalized
            expect(normalized).toMatchSnapshot('model-visible catalog, slash bodies, tool results and durable history')
          } else {
            expect(normalized).toBe(firstTranscript)
          }
        },
      })
      expect(result.stdout).toContain('Loaded all six Ponytail skills without Claude.')
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)
})
