/**
 * Scan an upstream import before it lands. The check fails on a changed path
 * the manifest's `dropPaths` covers, and on an added line that contains a CJK
 * character or an upstream identifier prefix the `identifierMap` maps; an
 * added line containing a `forbidden` word is listed for review, because the
 * vendor note keeps that word byte-identical in model-access configuration
 * and nowhere else. Scans the staged change by default, or `<base>...HEAD`
 * with `--base <rev>` ([procedure](../docs/cookbook/syncing-from-upstream.md)).
 */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CJK_CHARACTER,
  dropListEntry,
  readUpstreamSyncManifest,
  UPSTREAM_SYNC_MANIFEST_PATH,
  type UpstreamSyncManifest,
} from './upstream-sync-manifest.ts'

const root = resolve(import.meta.dirname, '..')
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** One changed file or added line that would carry upstream material into this tree. */
export interface ImportFinding {
  /** Repository-relative path of the changed file. */
  file: string
  /** 1-based line number in the new file; 0 for a finding about the whole file. */
  line: number
  /** `fail` blocks the import; `review` needs a person to confirm model-access configuration. */
  severity: 'fail' | 'review'
  /** What the file or line carries, and the fix. */
  problem: string
}

/**
 * Find the drop-listed files of a zero-context unified diff and the added
 * lines that carry CJK text, an unmapped upstream identifier, or a forbidden
 * word. The manifest itself is exempt: it names the identifiers it maps.
 * @param diff - `git diff -U0` output.
 * @param manifest - the validated manifest.
 * @returns findings in diff order.
 */
export function findImportProblems(diff: string, manifest: UpstreamSyncManifest): ImportFinding[] {
  const findings: ImportFinding[] = []
  let file: string | undefined
  let header = false
  let line = 0
  for (const text of diff.split('\n')) {
    if (text.startsWith('diff --git ')) {
      header = true
      file = undefined
      continue
    }
    const hunk = HUNK.exec(text)
    if (hunk !== null) {
      header = false
      line = Number(hunk[1])
      continue
    }
    if (header) {
      if (text.startsWith('+++ ')) file = text.startsWith('+++ b/') ? text.slice('+++ b/'.length) : undefined
      if (file !== undefined && dropListEntry(file, manifest) !== undefined) {
        findings.push({ file, line: 0, severity: 'fail', problem: 'drop-listed path; remove it from the import' })
        file = undefined
      }
      continue
    }
    if (!text.startsWith('+')) continue
    const added = text.slice(1)
    if (file !== undefined && file !== UPSTREAM_SYNC_MANIFEST_PATH) {
      if (CJK_CHARACTER.test(added)) findings.push({ file, line, severity: 'fail', problem: 'CJK text; translate it to Brazilian Portuguese' })
      const identifier = manifest.identifierMap.find(([upstream]) => added.includes(upstream))
      if (identifier !== undefined) {
        findings.push({ file, line, severity: 'fail', problem: `unmapped identifier ${identifier[0]}; map it to ${identifier[1]}` })
      }
      const lower = added.toLowerCase()
      const word = manifest.forbidden.find(forbidden => lower.includes(forbidden))
      if (word !== undefined) {
        findings.push({ file, line, severity: 'review', problem: `${word}: keep only in model-access configuration` })
      }
    }
    line++
  }
  return findings
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { base: { type: 'string' } } })
  const range = values.base === undefined ? ['--cached'] : [`${values.base}...HEAD`]
  const diff = execFileSync(
    'git',
    ['-C', root, '-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', ...range],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
  )
  const findings = findImportProblems(diff, readUpstreamSyncManifest(root))
  for (const finding of findings) {
    const print = finding.severity === 'fail' ? console.error : console.warn
    const location = finding.line === 0 ? finding.file : `${finding.file}:${String(finding.line)}`
    print(`${finding.severity}: ${location}: ${finding.problem}`)
  }
  const failures = findings.filter(finding => finding.severity === 'fail').length
  if (failures > 0) {
    console.error(`check-upstream-import: ${String(failures)} finding(s) block the import.`)
    process.exitCode = 1
  } else {
    console.log(`check-upstream-import: no drop-listed path, CJK text, or unmapped upstream identifier; ${String(findings.length)} line(s) to review.`)
  }
}
