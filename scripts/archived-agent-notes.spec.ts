import { describe, expect, it } from 'vitest'
import {
  extendArchiveManifest,
  gitBlobHash,
  parseArchiveManifest,
  parseBaselineArchiveManifest,
  renderArchiveManifest,
  validateArchiveArtifacts,
  validateArchiveManifestExtension,
  type ArchiveManifest,
} from './archived-agent-notes.ts'
import { isArchivedAgentNotePath } from './repo-files.ts'

function fixture(): Map<string, Buffer> {
  const base = '2026-07-26-example'
  const source = Buffer.from(`# Agent Note: Example\n\nStatus: implemented\nArchived: 2026-07-26\n\nEnglish | [Português](${base}.pt-BR.md)\n\n## Problem\n\nExample.\n`)
  const pt = Buffer.from(`# Agent Note: Exemplo\n\nStatus: implemented\nArchived: 2026-07-26\n\n[English](${base}.md) | Português\n\n## Problema\n\nExemplo.\n`)
  const meta = Buffer.from(`${base}.md: ${gitBlobHash(source)}\n${base}.pt-BR.md: ${gitBlobHash(pt)}\n`)
  return new Map([
    [`process/${base}.md`, source],
    [`process/${base}.pt-BR.md`, pt],
    [`process/${base}.i18n.yaml`, meta],
  ])
}

describe('archived Agent Notes', () => {
  it('recognizes archived paths with POSIX and Windows separators', () => {
    expect(isArchivedAgentNotePath('.agents/notes/archived/process/example.md')).toBe(true)
    expect(isArchivedAgentNotePath('.agents\\notes\\archived\\process\\example.md')).toBe(true)
    expect(isArchivedAgentNotePath('.agents/notes/implemented/process/example.md')).toBe(false)
  })

  it('accepts one complete implemented triplet with matching archive metadata', () => {
    expect(validateArchiveArtifacts(fixture())).toEqual([])
  })

  it('rejects incomplete triplets and invalid archive headers', () => {
    const artifacts = fixture()
    artifacts.delete('process/2026-07-26-example.i18n.yaml')
    artifacts.set(
      'process/2026-07-26-example.md',
      Buffer.from('# Agent Note: Example\n\nStatus: proposed\nArchived: yesterday\n'),
    )
    expect(validateArchiveArtifacts(artifacts).join('\n')).toMatch(/incomplete archived triplet/)
  })

  it('extends the manifest without permitting a sealed change or removal', () => {
    const artifacts = fixture()
    const empty: ArchiveManifest = { version: 2, files: {} }
    const first = extendArchiveManifest(empty, artifacts)
    expect(first.errors).toEqual([])
    expect(first.added).toHaveLength(3)

    const sealed: ArchiveManifest = { version: 2, files: first.files }
    const changed = new Map(artifacts)
    changed.set('process/2026-07-26-example.md', Buffer.from('changed'))
    expect(extendArchiveManifest(sealed, changed).errors).toEqual([
      'process/2026-07-26-example.md: sealed content hash changed',
    ])
    changed.delete('process/2026-07-26-example.pt-BR.md')
    expect(extendArchiveManifest(sealed, changed).errors).toContain(
      'process/2026-07-26-example.pt-BR.md: sealed artifact is missing',
    )
  })

  it('rejects replacing manifest seals alongside changed archive content', () => {
    const artifacts = fixture()
    const initial = extendArchiveManifest({ version: 2, files: {} }, artifacts)
    const baseline: ArchiveManifest = { version: 2, files: initial.files }
    const path = 'process/2026-07-26-example.md'
    const changedArtifacts = new Map(artifacts)
    changedArtifacts.set(path, Buffer.from('changed'))
    const replacement = extendArchiveManifest({ version: 2, files: {} }, changedArtifacts)
    const current: ArchiveManifest = { version: 2, files: replacement.files }

    expect(extendArchiveManifest(current, changedArtifacts).errors).toEqual([])
    expect(validateArchiveManifestExtension(baseline, current)).toEqual([
      `${path}: sealed manifest hash changed`,
    ])
    const removed: ArchiveManifest = {
      version: 2,
      files: Object.fromEntries(Object.entries(current.files).filter(([candidate]) => candidate !== path)),
    }
    expect(validateArchiveManifestExtension(baseline, removed)).toContain(
      `${path}: sealed manifest entry is missing`,
    )
  })

  it('treats a version 1 baseline as pinning nothing and binds every other baseline', () => {
    const seal = `sha256:${'a'.repeat(64)}`
    const versionOne = JSON.stringify({ version: 1, files: { 'process/z.md': seal } })
    expect(() => parseArchiveManifest(versionOne)).toThrow(/unsupported manifest version \(expected 2\)/)
    expect(parseBaselineArchiveManifest(versionOne)).toEqual({ version: 2, files: {} })
    expect(parseBaselineArchiveManifest(JSON.stringify({ version: 2, files: { 'process/z.md': seal } }))).toEqual({
      version: 2,
      files: { 'process/z.md': seal },
    })
    expect(() => parseBaselineArchiveManifest(JSON.stringify({ version: 3, files: {} }))).toThrow(/unsupported manifest version/)
    expect(() => parseBaselineArchiveManifest(JSON.stringify({ files: {} }))).toThrow(/expected exactly the fields/)
  })

  it('round-trips the deterministic manifest schema', () => {
    const content = renderArchiveManifest({ 'process/z.md': `sha256:${'a'.repeat(64)}` })
    expect(parseArchiveManifest(content)).toEqual({
      version: 2,
      files: { 'process/z.md': `sha256:${'a'.repeat(64)}` },
    })
  })
})
