import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  areaOf,
  collectTriage,
  eventMapRanges,
  localNoteIndex,
  renderTriage,
  type TriageReport,
  type TriageRow,
} from './gen-upstream-triage.ts'
import { parseUpstreamSyncManifest, type UpstreamSyncManifest } from './upstream-sync-manifest.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'arx-upstream-triage-'))
  roots.push(root)
  return root
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

function commitAll(root: string, message: string): string {
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', message])
  return git(root, ['rev-parse', 'HEAD'])
}

/** Land one change on master as a merged pull request. */
function mergePullRequest(root: string, pr: number, files: Readonly<Record<string, string>>, remove: readonly string[] = []): void {
  const branch = `topic-${String(pr)}`
  git(root, ['checkout', '-q', '-b', branch])
  write(root, files)
  for (const path of remove) git(root, ['rm', '-q', path])
  commitAll(root, `topic ${String(pr)}`)
  git(root, ['checkout', '-q', 'master'])
  git(root, ['merge', '-q', '--no-ff', '-m', `Merge pull request #${String(pr)} from owner/${branch}`, branch])
}

const note = (title: string): string => `# Agent Note: ${title}\n`

const EVENTS_V1 = [
  'declare module \'@up/up-session\' {',
  '  interface SessionEventMap {',
  '    \'plugin/first\': { a: string }',
  '  }',
  '}',
  'export const unrelated = 1',
  '',
].join('\n')
const EVENTS_V2 = EVENTS_V1.replace('    \'plugin/first\': { a: string }', '    \'plugin/first\': { a: string }\n    \'plugin/second\': { b: number }')
const EVENTS_V3 = EVENTS_V2.replace('export const unrelated = 1', 'export const unrelated = 2')

/** An upstream repository whose first commit is the fork base. */
function upstream(): { root: string; base: string } {
  const root = temporaryRoot()
  git(root, ['init', '-q', '--initial-branch=master'])
  git(root, ['config', 'user.email', 'triage@example.com'])
  git(root, ['config', 'user.name', 'Triage Tests'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  git(root, ['config', 'core.hooksPath', join(root, '.git', 'no-hooks')])
  write(root, {
    'README.md': '# upstream\n',
    'packages/core/session/src/index.ts': 'export const version = 1\n',
    'packages/plugin/events/src/events.ts': EVENTS_V1,
    '.agents/notes/implemented/feature/2026-01-01-before-the-fork.md': note('before'),
  })
  return { root, base: commitAll(root, 'base') }
}

function manifestFor(base: string, verdicts: Record<string, unknown> = {}): UpstreamSyncManifest {
  return parseUpstreamSyncManifest(JSON.stringify({
    repository: 'https://example.invalid/upstream.git',
    forkBase: base,
    dropPaths: ['packages/llm/llm-acme/', '*.zh.md'],
    corePaths: ['packages/core/*/src/'],
    identifierMap: [['@up/up-', '@arx-ai/arx-']],
    slugRenames: { acme: 'vendor', up: 'arx' },
    forbidden: ['acme'],
    verdicts,
  }))
}

/** An upstream history that exercises every classification path. */
function history(): { root: string; base: string; localNotes: Map<string, string> } {
  const { root, base } = upstream()
  mergePullRequest(root, 11, {
    '.agents/notes/implemented/feature/2026-01-02-client-thing.md': note('client'),
    '.agents/notes/implemented/feature/2026-01-02-client-thing.zh.md': note('translated side'),
    'packages/client/ui-x/src/a.ts': 'export const a = 1\n',
    'docs/guide.zh.md': 'translated side\n',
  })
  mergePullRequest(root, 12, {
    '.agents/notes/implemented/architecture/2026-01-03-core-change.md': note('core'),
    'packages/core/session/src/index.ts': 'export const version = 2\n',
    'packages/core/session/README.md': '# session\n',
  })
  mergePullRequest(root, 13, {
    '.agents/notes/implemented/feature/2026-01-04-event-member.md': note('event member'),
    'packages/plugin/events/src/events.ts': EVENTS_V2,
  })
  mergePullRequest(root, 14, {
    '.agents/notes/implemented/feature/2026-01-05-event-neighbour.md': note('event neighbour'),
    'packages/plugin/events/src/events.ts': EVENTS_V3,
  })
  write(root, {
    '.agents/notes/implemented/feature/2026-01-06-acme-login.md': note('login'),
    'packages/llm/llm-acme/src/login.ts': 'export {}\n',
  })
  commitAll(root, 'feat: sign in (#15)')
  mergePullRequest(root, 16, {
    '.agents/notes/implemented/feature/2026-01-07-verdict-note.md': note('verdict'),
    'packages/client/ui-y/src/b.ts': 'export const b = 1\n',
    'packages/llm/llm-acme/src/extra.ts': 'export {}\n',
  })
  mergePullRequest(root, 17, { '.agents/notes/proposed/feature/2026-01-08-moved.md': note('moved') })
  mergePullRequest(
    root,
    18,
    { '.agents/notes/implemented/feature/2026-01-08-moved.md': note('moved') },
    ['.agents/notes/proposed/feature/2026-01-08-moved.md'],
  )
  write(root, { '.agents/notes/proposed/process/2026-01-09-direct.md': note('direct') })
  commitAll(root, 'chore: record a proposal')
  mergePullRequest(root, 19, {
    '.agents/notes/implemented/feature/2026-01-10-present.md': note('present'),
    '.agents/notes/rejected/feature/2026-01-11-diverged.md': note('diverged'),
    '.agents/notes/archived/feature/2026-01-12-archived.md': note('archived'),
    'package.json': '{}\n',
    'apps/web/src/x.ts': 'export {}\n',
    'packages/README.md': '# packages\n',
    'packages/llm/README.md': '# llm\n',
    'weird dir/x.md': 'x\n',
    'scripts/a.ts': 'export {}\n',
  })
  mergePullRequest(root, 20, { 'packages/client/ui-x/src/a.ts': 'export const a = 2\n' })
  const localNotes = new Map([
    ['2026-01-10-present', '.agents/notes/implemented/feature/2026-01-10-present.md'],
    ['2026-01-11-diverged', '.agents/notes/implemented/feature/2026-01-11-diverged.md'],
  ])
  return { root, base, localNotes }
}

function rowNamed(rows: readonly TriageRow[], name: string): TriageRow {
  const row = rows.find(candidate => candidate.name === name)
  if (row === undefined) throw new Error(`no row ${name}`)
  return row
}

// Each case spawns dozens of git processes, which Windows runners start slowly.
describe('collectTriage', { timeout: 30_000 }, () => {
  it('classifies every note added on the first-parent history after the fork base', () => {
    const { root, base, localNotes } = history()
    const verdicts = { 'verdict-note': { class: 'incorporate', reason: 'small: one cherry-pick' } }
    const report = collectTriage({ checkout: root, ref: 'master', manifest: manifestFor(base, verdicts), localNotes })

    expect(report.sha).toBe(git(root, ['rev-parse', 'master']))
    expect(report.date).toBe(git(root, ['log', '-1', '--format=%cI', 'master']))
    expect(report.rows.map(row => row.name)).toEqual([
      'client-thing', 'core-change', 'event-member', 'event-neighbour', 'vendor-login',
      'verdict-note', 'moved', 'direct', 'present', 'diverged',
    ])
    expect(rowNamed(report.rows, 'client-thing')).toEqual({
      date: '2026-01-02',
      name: 'client-thing',
      status: 'implemented',
      pr: 11,
      commit: git(root, ['rev-parse', 'master~10']).slice(0, 10),
      areas: ['client/ui-x'],
      dropListed: false,
      class: 'untriaged',
      reason: '',
    })
    expect(rowNamed(report.rows, 'core-change')).toMatchObject({
      areas: ['core/session'],
      class: 'evaluate',
      reason: 'core rule applies: changes core/session',
    })
    expect(rowNamed(report.rows, 'event-member')).toMatchObject({
      class: 'evaluate',
      reason: 'core rule applies: changes SessionEventMap',
    })
    expect(rowNamed(report.rows, 'event-neighbour')).toMatchObject({ class: 'untriaged', reason: '' })
    expect(rowNamed(report.rows, 'vendor-login')).toMatchObject({
      pr: 15,
      areas: [],
      dropListed: true,
      class: 'drop',
      reason: 'touches only drop-listed paths',
    })
    expect(rowNamed(report.rows, 'verdict-note')).toMatchObject({
      areas: ['client/ui-y'],
      dropListed: true,
      class: 'incorporate',
      reason: 'small: one cherry-pick',
    })
    expect(rowNamed(report.rows, 'moved')).toMatchObject({ status: 'implemented', pr: 18 })
    expect(rowNamed(report.rows, 'direct')).toMatchObject({ status: 'proposed', pr: undefined, areas: [] })
    expect(rowNamed(report.rows, 'present')).toMatchObject({ class: 'present', reason: 'here as implemented' })
    expect(rowNamed(report.rows, 'diverged')).toMatchObject({
      status: 'rejected',
      class: 'untriaged',
      reason: 'here as implemented, upstream as rejected',
      areas: ['(other)', '(root)', 'apps/web', 'packages', 'packages/llm', 'scripts'],
    })
  })

  it('refuses a revision the fork base does not precede', () => {
    const { root, base } = upstream()
    git(root, ['checkout', '-q', '--orphan', 'unrelated'])
    commitAll(root, 'unrelated history')
    expect(() => collectTriage({ checkout: root, ref: 'unrelated', manifest: manifestFor(base), localNotes: new Map() }))
      .toThrow(`fork base ${base} is not an ancestor of unrelated`)
  })

  it('refuses a verdict that names no note or a note already here', () => {
    const { root, base } = upstream()
    mergePullRequest(root, 11, { '.agents/notes/implemented/feature/2026-01-02-landed.md': note('landed') })
    const unknown = manifestFor(base, { missing: { class: 'drop', reason: 'no such note' } })
    expect(() => collectTriage({ checkout: root, ref: 'master', manifest: unknown, localNotes: new Map() }))
      .toThrow('verdicts.missing names no Agent Note added upstream after the fork base')
    const stale = manifestFor(base, { landed: { class: 'incorporate', reason: 'imported since' } })
    const localNotes = new Map([['2026-01-02-landed', '.agents/notes/implemented/feature/2026-01-02-landed.md']])
    expect(() => collectTriage({ checkout: root, ref: 'master', manifest: stale, localNotes }))
      .toThrow('verdicts.landed is stale; the note is already here; remove the verdict')
  })
})

describe('renderTriage', () => {
  const row: TriageRow = {
    date: '2026-01-02',
    name: 'client-thing',
    status: 'implemented',
    pr: 11,
    commit: '0123456789',
    areas: ['client/ui-a', 'client/ui-b', 'client/ui-c', 'client/ui-d', 'client/ui-e'],
    dropListed: true,
    class: 'incorporate',
    reason: 'one | two',
  }
  const report: TriageReport = {
    sha: 'abcdef0123456789abcdef0123456789abcdef01',
    date: '2026-01-31T00:00:00+00:00',
    rows: [row, { ...row, name: 'bare', pr: undefined, areas: [], dropListed: false, class: 'untriaged', reason: '' }],
  }
  const manifest = manifestFor('0'.repeat(40))

  it('renders the summary and one row per note without upstream prose', () => {
    const page = renderTriage(report, manifest)
    expect(page.startsWith('<!-- Generated by scripts/gen-upstream-triage.ts')).toBe(true)
    expect(page).toContain('through upstream commit `abcdef0123` (2026-01-31T00:00:00+00:00)')
    expect(page).toContain('| incorporate | 1 |\n| evaluate | 0 |')
    expect(page).toContain('| untriaged | 1 |')
    expect(page).toContain('| 2026-01-02 | `client-thing` | implemented | `11` | `0123456789` | client/ui-a, client/ui-b, client/ui-c, client/ui-d, +1 more, drop-listed paths | incorporate | one \\| two |')
    expect(page).toContain('| 2026-01-02 | `bare` | implemented | — | `0123456789` | notes only | untriaged | — |')
    expect(page.endsWith('|\n')).toBe(true)
  })

  it('refuses a page that would carry CJK text or a forbidden word', () => {
    const cjk = { ...report, rows: [{ ...row, reason: `note ${String.fromCodePoint(0x4e2d)}` }] }
    expect(() => renderTriage(cjk, manifest)).toThrow(/line \d+ would contain a CJK character/)
    const forbidden = { ...report, rows: [{ ...row, name: 'acme-thing' }] }
    expect(() => renderTriage(forbidden, manifest)).toThrow(/line \d+ would contain a forbidden word; add a slugRenames entry/)
  })
})

describe('areaOf', () => {
  const manifest = manifestFor('0'.repeat(40))

  it.each([
    ['package.json', '(root)'],
    ['packages/README.md', 'packages'],
    ['packages/llm/README.md', 'packages/llm'],
    ['packages/llm/llm-up/src/index.ts', 'llm/llm-arx'],
    ['apps/README.md', 'apps'],
    ['apps/web/src/main.ts', 'apps/web'],
    ['scripts/check.ts', 'scripts'],
    ['weird dir/file.md', '(other)'],
  ])('%s belongs to %s', (path, area) => {
    expect(areaOf(path, manifest)).toBe(area)
  })
})

describe('eventMapRanges', () => {
  it('spans each declaration body across nested braces', () => {
    const source = [
      'interface SessionEventMap {', // 1
      '  a: { nested: { deep: string } }', // 2
      '}', // 3
      'const x = {}', // 4
      'declare module \'m\' { interface SessionEventMap {', // 5
      '  b: string', // 6
      '} }', // 7
    ].join('\n')
    expect(eventMapRanges(source)).toEqual([[1, 3], [5, 7]])
  })

  it('ignores a declaration whose body never closes', () => {
    expect(eventMapRanges('interface SessionEventMap {\n  a: string\n')).toEqual([])
  })
})

describe('localNoteIndex', () => {
  it('indexes dated notes in every status directory and skips translation sides', () => {
    const root = temporaryRoot()
    write(root, {
      '.agents/notes/implemented/feature/2026-01-01-kept.md': note('kept'),
      '.agents/notes/implemented/feature/2026-01-01-kept.pt-BR.md': note('side'),
      '.agents/notes/archived/process/2026-01-02-old.md': note('old'),
      '.agents/notes/README.md': '# notes\n',
    })
    expect([...localNoteIndex(root)]).toEqual([
      ['2026-01-02-old', '.agents/notes/archived/process/2026-01-02-old.md'],
      ['2026-01-01-kept', '.agents/notes/implemented/feature/2026-01-01-kept.md'],
    ])
  })
})
