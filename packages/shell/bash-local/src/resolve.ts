/**
 * Git Bash executable resolution for the bash capability seam, dependency-free
 * so non-package consumers (the repository's Windows parity gate and its
 * vitest availability probes) can share the ONE resolution definition with the
 * executor and its suites — a probe that resolved differently from the code
 * under test could exempt a file whose suites actually run.
 *
 * Unlike the pwsh seam there is NO last-resort fallback executable: POSIX
 * command strings diverge silently under substitutes (WSL's System32 stub, an
 * incomplete upgrade), so a probing miss is a loud failure naming the search.
 *
 * @module @arx-ai/arx-bash-local/resolve
 */

import { lstatSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Whether a PATH entry names the WSL launcher tree rather than a real Git
 * Bash. `C:\Windows\System32\bash.exe` execs the Windows Subsystem for Linux,
 * whose mount and credential model silently diverge from Git Bash; Node's
 * spawn would happily use it, so it is excluded from PATH resolution.
 * @param entry - one PATH entry, trimmed and unquoted.
 * @returns whether the entry is Windows' own WSL host directory.
 */
function isSystem32Entry(entry: string): boolean {
  const normalized = entry.replace(/\\/g, '/').toLowerCase()
  return /(^|\/)windows\/system32\/?$/.test(normalized)
}

/**
 * Well-known Git for Windows install locations plus PATH entries. Explicitly
 * parameterized (env) so resolution is a pure function of its inputs on every
 * platform.
 * @param env - the environment to probe; defaults to the process environment.
 * @returns candidate `bash.exe` paths in resolution order.
 */
export function candidateBashPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
  const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const candidates = [
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'bin', 'bash.exe'),
  ]
  // Git for Windows also puts bash.exe on PATH when the user added its
  // bin tree; entries may carry surrounding quotes from `setx`-style definitions.
  for (const entry of (env.PATH ?? '').split(';')) {
    const trimmed = entry.trim().replace(/^"/, '').replace(/"$/, '')
    if (trimmed.length === 0 || isSystem32Entry(trimmed)) continue
    candidates.push(join(trimmed, 'bash.exe'))
  }
  return candidates
}

/**
 * Whether a candidate can be spawned. lstat opens the entry itself instead of
 * following reparse points, so it sees app-execution aliases where stat hits
 * the target's ACL (EACCES); a real directory never matches.
 */
function candidateExists(candidate: string): boolean {
  try {
    const stat = lstatSync(candidate)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    // ENOENT (the candidate vanished between listing and probing) is the only
    // expected failure; any other error names an unspawnable path, so false
    // is the safe answer for it too.
    return false
  }
}

/**
 * Resolve the bash executable this executor spawns. On POSIX the name is
 * resolved by spawn; on Windows the well-known Git for Windows locations and
 * PATH entries are probed, and a probing miss refuses loudly instead of
 * returning a substitute.
 * @param configured - an explicit `bashPath` config value, trusted as-is.
 * @param env - the environment to probe on Windows; defaults to the process environment.
 * @param platform - the platform to resolve for; defaults to the process platform.
 * @returns the executable name or path to hand to the subprocess seam.
 * @throws when Windows probing finds no Git Bash and no explicit path is configured.
 */
export function resolveBashPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (configured !== undefined && configured.length > 0) return configured
  if (platform === 'win32') {
    const searched: string[] = []
    for (const candidate of candidateBashPaths(env)) {
      if (candidateExists(candidate)) return candidate
      searched.push(candidate)
    }
    throw new Error(
      'bash-local: no Git Bash executable found; a POSIX-compatible bash is required for the bash family on Windows. '
      + `Searched: ${searched.join(', ')}. Install Git for Windows (its bash.exe provides the POSIX environment) `
      + 'or set the bashPath config entry.',
    )
  }
  return 'bash'
}
