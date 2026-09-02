/**
 * Windows parity gate: the load-bearing invariants that keep Windows a
 * first-class platform, checked statically on any host (TS seam contract
 * mirrored by its `.spec.ts` fixtures).
 * @module scripts/verify-windows-parity
 */

import { readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'

import { join, relative, resolve, sep } from 'node:path'

/** Walking scope for the SKILL.md POSIX-syntax detector. */
const ROOT = resolve(import.meta.dirname, '..')

/** Directory names pruned at any depth (build outputs and vendored copies). */
const PRUNED_PARTS = new Set(['node_modules', 'dist', 'dist-exe', 'coverage', '.git'])

/** Directory names pruned at the top level only (repo-local product surfaces). */
const PRUNED_ROOT_PARTS = new Set(['lib', 'lib-examples', 'www', 'build', 'tmp'])

/**
 * The base-patch gauge: shipped default base-patch rows whose values must
 * keep a complementary win32 rung. `expectDisabledOn` true = row disabled on
 * win32; false = disabled everywhere else. Editing either side without its
 * twin, or dropping the `disabled:` line, fails the gate here instead of
 * silently breaking the default Windows composition.
 */
const BASE_PATCH_PLATFORM_ROWS: ReadonlyMap<string, boolean> = new Map([
  ['bash-sandbox', true],
  ['pwsh-sandbox', false],
  ['tool-bash', true],
  ['tool-pwsh', false],
])

/** One check's outcome; failures collect instead of throwing so every area reports at once. */
interface Finding {
  check: string
  subject: string
  hint: string
}

/** Build one finding. */
function finding(check: string, subject: string, hint: string): Finding {
  return { check, subject, hint }
}

/**
 * Base-patch platform-gating gauge over the composed patch text. Watched rows
 * must carry `disabled: !!js process.platform <op> 'win32'` with the expected
 * polarity; anything else (no rung, drifted expression) fails loud at the row id.
 * @param text - the raw `packages/bundle/base/cordis.patch.yml` text.
 * @returns findings, empty when every watched row keeps its win32 rung.
 */
export function basePatchPlatformGating(text: string): Finding[] {
  const findings: Finding[] = []
  const rows = new Map<string, string>()
  let current = 'unknown'
  for (const line of text.split('\n')) {
    const id = /^\s*- id:\s*(\S+)\s*$/.exec(line)
    if (id !== null) {
      current = id[1] ?? 'unknown'
      continue
    }
    const disabled = /^\s+disabled:\s+(.+)$/.exec(line)
    if (disabled !== null && !rows.has(current)) {
      rows.set(current, (disabled[1] ?? '').trim())
    }
  }
  for (const [id, disabledOnWin32] of BASE_PATCH_PLATFORM_ROWS) {
    const actual = rows.get(id)
    const expected = disabledOnWin32
      ? "!!js process.platform === 'win32'"
      : "!!js process.platform !== 'win32'"
    if (actual !== expected) {
      findings.push(finding(
        'base-patch-win32-rung',
        `packages/bundle/base/cordis.patch.yml row ${id}`,
        `expected \`disabled: ${expected}\` (the complementary win32 rung of the ${disabledOnWin32 ? 'bash' : 'pwsh'} family); found ${actual === undefined ? 'no disabled line' : `\`disabled: ${actual}\``}. The base bundle is every profile's shared default; an incomplete platform override leaves one platform composing a family it cannot execute.`,
      ))
    }
  }
  return findings
}

/** Shell-script file reference inside a command line. */
const SHELL_SCRIPT_REF = /(?:^|[\s"'=(/])([\w./\\-]+\.sh)\b/

/**
 * The pre-commit command inventory must be cross-platform executable: a
 * `.sh` job there silently degrades Windows dev parity for every contributor.
 * @param text - the raw lefthook.yml text.
 * @returns findings for each `run:` naming a shell script.
 */
export function lefthookShellJobs(text: string): Finding[] {
  return [...text.matchAll(/^\s+run:\s+(.+)$/gm)]
    .map(match => match[1] ?? '')
    .filter(value => SHELL_SCRIPT_REF.test(value))
    .map(value => finding(
      'lefthook-cross-platform',
      `lefthook.yml run: ${value}`,
      'pre-commit runs on Windows development hosts too; every job must execute through node_modules/.bin/tsx (see scripts/check-vendor-manifest.ts for the ported seam twin).',
    ))
}

/** Source file whose Windows-lane gate functions own the shell-invocation contract. */
const RUN_GATES_SOURCE = join(ROOT, 'scripts/run-gates.ts')

/** Gate-construction functions whose produced commands run on Windows lanes. */
const WINDOWS_GATE_FUNCTIONS = [
  'ciWindowsBlockingGates',
  'ciWindowsCompleteGates',
  'ciWindowsObservationalGates',
  'ciSharedStaticGates',
  'ciStaticGates',
] as const
type WindowsGateFunction = (typeof WINDOWS_GATE_FUNCTIONS)[number]

/**
 * Gate commands constructed for the Windows lanes must be `.sh`-free: those
 * lanes run on `windows-2025` / self-hosted Windows, where a bash invocation
 * reaches Git Bash (or nothing) by accident instead of by contract. The check
 * reads `run-gates.ts` structurally (the mode functions' string literals) so
 * importing the runner — which insists on a pnpm environment — is impossible
 * here. `check:windows-wine` is not part of any CI aggregate and stays untouched.
 * @returns findings for Windows-lane gate constructions touching a `.sh` script or the bash/sh interpreters.
 */
export function windowsGateShellScripts(): Finding[] {
  const text = readFileSync(RUN_GATES_SOURCE, 'utf8')
  const findings: Finding[] = []
  for (const name of WINDOWS_GATE_FUNCTIONS as readonly WindowsGateFunction[]) {
    const body = gateFunctionBody(text, name)
    for (const script of [...body.matchAll(/'([^']*\.(?:sh|\{sh,})[^']*)'|"([^"]*\.sh[^"]*)"/g)]
      .map(match => match[1] ?? match[2] ?? '')) {
      findings.push(finding(
        'windows-gate-shell-script',
        `run-gates ${name}(): ${script}`,
        'The Windows gate lanes execute on windows-2025/self-hosted Windows; port the command to tsx (see scripts/check-vendor-manifest.ts for the seam-twin precedent).',
      ))
    }
    if (/\['(?:bash|sh)'/.test(body)) {
      findings.push(finding(
        'windows-gate-shell-interpreter',
        `run-gates ${name}(): builds an argv starting with 'bash'/'sh'`,
        'The Windows gate lanes cannot rely on a POSIX shell; port the command to tsx.',
      ))
    }
  }
  return findings
}

/**
 * Extract one top-level function's source text (from its declaration to the
 * next top-level function/const boundary). A missing function's empty body is
 * correct here: the caller's findings stay empty and structural renames in
 * `run-gates.ts` fail noisily in review, not at runtime.
 * @param text - the full `run-gates.ts` source.
 * @param name - the gate-construction function name to slice out.
 * @returns the function's source text, possibly empty.
 */
function gateFunctionBody(text: string, name: WindowsGateFunction): string {
  const start = text.search(new RegExp(`\nfunction ${name}\\(`))
  if (start < 0) return ''
  const following = text.slice(start + 1).search(/\n(?:async )?function \w+\(/)
  const end = following < 0 ? text.length : start + 1 + following
  return text.slice(start, end)
}

/** A `.sh` invocation through a POSIX shell name, or a raw `bash -c`. */
const POSIX_SCRIPT_INVOCATION = /\b(?:ba)?sh\s+(?:[^\s|;&]*\/)?[\w@%+=:,./~\\-]*\.sh\b|\bbash\s+-c\b/

/** `sed -i`, whose in-place edit has no pwsh 7 equivalent. */
const POSIX_SED_IN_PLACE = /(?:^|\s)sed\s+[^\n|;&]*\s-i\b/

/** POSIX-only syntax in a fenced bash/sh block that pwsh 7 cannot execute. */
const POSIX_ONLY_LINE = new RegExp(`${POSIX_SCRIPT_INVOCATION.source}|${POSIX_SED_IN_PLACE.source}`)

/** Fenced code block languages that mean a POSIX shell. */
const POSIX_FENCE_LANGUAGES = new Set(['bash', 'sh', 'shell'])

/** Fenced code block languages that mean a Windows PowerShell variant. */
const PWSH_FENCE_LANGUAGES = new Set(['pwsh', 'powershell', 'powershellcore'])

/**
 * Scan one SKILL.md's fenced blocks for POSIX-only shell commands with no
 * pwsh variant anywhere in the file. Hook and skill instructions authored for
 * bash break under the pwsh family Windows composes by default; the
 * file-level pwsh-fence requirement is the cheap, drift-proof signal that a
 * Windows variant exists.
 * @param path - reporting path for the finding.
 * @param lines - the file's lines.
 * @returns one finding per offending fenced-block line.
 */
export function skillPosixSyntax(path: string, lines: readonly string[]): Finding[] {
  const findings: Finding[] = []
  const hasPwshVariant = lines.some(line => /^```(?:\s*)(\S*)/.test(line) && PWSH_FENCE_LANGUAGES.has((/^```(?:\s*)(\S*)/.exec(line)?.[1] ?? '').toLowerCase()))
  let fenceLanguage: string | undefined
  let blockStartLine = 0
  for (const [index, line] of lines.entries()) {
    const fence = /^```(?:\s*)(\S*)/.exec(line)
    if (fence !== null) {
      if (fenceLanguage === undefined) {
        fenceLanguage = (fence[1] ?? '').toLowerCase()
        blockStartLine = index
      } else {
        fenceLanguage = undefined
      }
      continue
    }
    if (fenceLanguage === undefined || !POSIX_FENCE_LANGUAGES.has(fenceLanguage)) continue
    if (POSIX_ONLY_LINE.test(line) && !hasPwshVariant) {
      findings.push(finding(
        'skill-posix-syntax',
        `${path}:${blockStartLine + 1}: ${line.trim()}`,
        'POSIX-only shell syntax with no pwsh variant in the file. Add a fenced ```pwsh block (or rewrite to a portable pnpm/node form) so Windows compositions keep following the instructions.',
      ))
    }
  }
  return findings
}

/**
 * Walk the repository (pruning vendored and build trees) and run the SKILL.md
 * detector over each file. Unknown read failures (a builder racing the walk)
 * prune that subtree; the next run re-reads it.
 * @param directory - directory to walk from; defaults to the repository root.
 * @param depth - walk depth, counting the repository root as 0.
 * @returns findings across every SKILL.md found.
 */
export async function scanSkillFiles(directory: string = ROOT, depth = 0): Promise<Finding[]> {
  const findings: Finding[] = []
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (PRUNED_PARTS.has(entry.name) || (depth === 0 && PRUNED_ROOT_PARTS.has(entry.name))) continue
      findings.push(...await scanSkillFiles(path, depth + 1))
      continue
    }
    if (entry.isFile() && entry.name === 'SKILL.md') {
      const lines = (await readFile(path, 'utf8')).split('\n')
      findings.push(...skillPosixSyntax(relative(ROOT, path).split(sep).join('/'), lines))
    }
  }
  return findings
}

import { isEntry } from './release/process.ts'

if (isEntry(import.meta.url)) await main()

/**
 * Run every parity check against the repository state and report.
 * @returns the exit code: 0 green, 1 with every finding printed.
 */
async function main(): Promise<number> {
  const [patch, lefthook] = await Promise.all([
    readFile(join(ROOT, 'packages/bundle/base/cordis.patch.yml'), 'utf8'),
    readFile(join(ROOT, 'lefthook.yml'), 'utf8'),
  ])
  const findings = [
    ...basePatchPlatformGating(patch),
    ...lefthookShellJobs(lefthook),
    ...windowsGateShellScripts(),
    ...(await scanSkillFiles()),
  ]
  if (findings.length === 0) {
    console.log('verify-windows-parity: OK - base-patch win32 rungs, cross-platform pre-commit and gates, SKILL.md syntax.')
    return 0
  }
  for (const { check, subject, hint } of findings) {
    console.error(`verify-windows-parity: [${check}] ${subject}`)
    console.error(`  ${hint}`)
  }
  return 1
}
