/**
 * Vendoring discipline, mechanized: any staged change under a vendored
 * package's `src/` tree or its vendored `bin.js` must come with a
 * vendor/README.md change in the same commit (the manifest's
 * local-modification log is the contract — see vendor/README.md).
 * Runs as a lefthook pre-commit job on every platform; the
 * `.spec.ts` pins the classification and the guard failure, while the hook
 * itself supplies the staged set.
 * @module scripts/check-vendor-manifest
 */

import { spawnSync } from 'node:child_process'

import { isEntry } from './release/process.ts'

/** The staged paths that count as vendored source, and whether the manifest changed too. */
export interface VendorManifestClassification {
  /** Staged vendored-source paths in original order, possibly empty. */
  vendored: readonly string[]
  /** Whether `vendor/README.md` is staged. */
  manifest: boolean
}

/**
 * Classify staged paths: vendored source is anything under `vendor/<pkg>/src/`
 * plus a vendored `bin.js`; the manifest guards all of it.
 * @param staged - the staged path list, exactly as `git diff --cached --name-only` reports it.
 * @returns the classification.
 */
export function classifyVendorManifest(staged: readonly string[]): VendorManifestClassification {
  const vendored = staged.filter(path => /^vendor\/[^/]+\/(src\/|bin\.js$)/.test(path))
  return { vendored, manifest: staged.includes('vendor/README.md') }
}

/**
 * The staged path list: NUL-free LF-separated names, filtered for blanks.
 * `git` unavailable is a loud failure, never a pass.
 * @returns the staged paths.
 */
function stagedPaths(): string[] {
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
  if (result.error !== undefined) {
    throw new Error(`vendor manifest guard: cannot run git: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`vendor manifest guard: git diff --cached --name-only failed with exit code ${result.status}.`)
  }
  return result.stdout.split('\n').filter(line => line.length > 0)
}

/** Classify the staged set and exit 1 when vendored source moves without its manifest. */
function main(): void {
  const { vendored, manifest } = classifyVendorManifest(stagedPaths())
  if (vendored.length === 0 || manifest) return
  console.error('vendor manifest guard: vendored SOURCE changed without updating vendor/README.md:')
  for (const path of vendored) console.error(`  ${path}`)
  console.error('Log the modification in vendor/README.md ("Local modifications") and stage it.')
  process.exitCode = 1
}

if (isEntry(import.meta.url)) main()
