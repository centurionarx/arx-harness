/**
 * Gate for forbidden credential or endpoint environment inlines in shipped
 * Cordis configuration.
 * @module scripts/verify-config-source-ownership
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/** Shipped Cordis configuration these rules apply to. */
const SHIPPED_CONFIG_GLOBS = [
  'apps/*/config/*.yml',
  'examples/*/*.cordis.yml',
  'examples/*/cordis.yml',
  // Bundle identity comes from the package manifest, not the domain directory.
  'packages/*/*/cordis.patch.yml',
  // The Python runtime ships its own default composition inside the wheel.
  'python/*/src/**/cordis.yml',
]

/**
 * Build output the Python runtime glob would otherwise reach: the executable
 * build copies the whole package under `runtime/node/`, and that copy is
 * gitignored, so a hit there reports the checked-in file twice.
 */
const BUILD_OUTPUT_SEGMENT = `${sep}runtime${sep}node${sep}`

/**
 * Compositions whose endpoint follows the launching environment by design.
 * The SDK client sets `DEEPSEEK_BASE_URL` per session from the caller's own
 * `base_url`, and the file lives inside the wheel where no deployment edits
 * it, so a present value names the caller rather than a discovered file. The
 * adapter reads no endpoint from the environment on its own; the exemption
 * ends when it does
 * (.agents/notes/proposed/architecture/2026-09-06-the-adapter-resolves-its-endpoint-from-the-launch-environment.md).
 */
const ENDPOINT_FOLLOWS_LAUNCH = new Set([
  'python/sdk-runtime/src/arx_harness_runtime/runtime/cordis.yml',
])

/** Ordinary single-line configuration forms this source check rejects; not full YAML analysis. */
const INLINE_DENY = /^\s*(apiKey|baseURL|apiKeyEnv|authToken|headers)\s*:\s*!!js\b/

/** Return every forbidden inline environment form in shipped configuration. */
export function collectConfigSourceOwnershipViolations(root: string): string[] {
  const failures: string[] = []
  for (const glob of SHIPPED_CONFIG_GLOBS) {
    const files = globSync(glob, { cwd: root, exclude: path => path.includes(BUILD_OUTPUT_SEGMENT) })
    for (const file of files) {
      const rel = file.split(sep).join('/')
      readFileSync(resolve(root, rel), 'utf8').split('\n').forEach((line, index) => {
        const match = INLINE_DENY.exec(line)
        if (match === null) return
        if (match[1] === 'baseURL' && ENDPOINT_FOLLOWS_LAUNCH.has(rel)) return
        failures.push(
          `${rel}:${String(index + 1)}: inlines a credential or endpoint from the environment.`
          + ' The adapter resolves apiKeyEnv through ctx.credentials and takes the endpoint from the route'
          + ' or the installed catalog; inlining here bypasses the credential ladder and hides who set the endpoint.',
        )
      })
    }
  }
  return failures
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const failures = collectConfigSourceOwnershipViolations(ROOT)
  if (failures.length > 0) {
    process.stderr.write('verify-config-source-ownership: configuration source ownership violated:\n')
    for (const failure of failures) process.stderr.write(`  ${failure}\n`)
    process.exit(1)
  }

  process.stdout.write(
    'verify-config-source-ownership: no credential or endpoint uses the ordinary inline environment form'
    + ' in shipped configuration.\n',
  )
}
