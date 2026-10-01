/**
 * The entry the engine spawns for each run. The built package spawns sibling `lib/worker.cjs` by
 * filesystem path, the form pkg's VFS Worker hook resolves. Source mode bundles `src/worker.ts`
 * and its workspace imports into one ES module and spawns it from a `data:` URL, so the worker
 * installs no TypeScript loader hooks. See
 * `.agents/notes/implemented/architecture/2026-10-01-source-workflow-worker-runs-a-bundle.md`.
 * @module @arx-ai/arx-workflow-worker-thread/entry
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type * as Esbuild from 'esbuild'

/** A Worker entry: a filesystem path (built) or a `data:` URL holding the bundle (source). */
export type WorkerEntry = string | URL

const IMPORT_META_URL = /\bimport\.meta\.url\b/g

/**
 * A bundle loaded from a `data:` URL has no location of its own, so each module's
 * `import.meta.url` is replaced with its source file's URL before esbuild parses it.
 */
const pinImportMetaUrl: Esbuild.Plugin = {
  name: 'pin-import-meta-url',
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, async ({ path }) => ({
      contents: (await readFile(path, 'utf8')).replaceAll(IMPORT_META_URL, JSON.stringify(pathToFileURL(path).href)),
      loader: 'ts',
    }))
  },
}

/**
 * Resolve the worker entry for this package's own shape: built output spawns `lib/worker.cjs`,
 * and source spawns a fresh bundle of `src/worker.ts`.
 * @returns the entry every run of one engine instance spawns.
 */
export async function resolveWorkerEntry(): Promise<WorkerEntry> {
  /* v8 ignore next 3 -- the built-output arm: tests always run unbuilt (src/); the built-worker e2e exercises this shape for real */
  if (!import.meta.url.endsWith('.ts')) {
    return fileURLToPath(new URL('./worker.cjs', import.meta.url))
  }
  return bundleWorkerSource(fileURLToPath(new URL('./worker.ts', import.meta.url)))
}

/**
 * Bundle a TypeScript entry and everything it imports into one ES module for the running Node
 * version. Workspace imports resolve through each source file's nearest `tsconfig.json`, so the
 * result does not depend on the host's working directory. Each module's `import.meta.url` names
 * its source file; any other `import.meta` use rejects instead of evaluating to an empty object.
 * @param entryPoint - absolute path of the TypeScript entry module.
 * @returns a `data:` URL whose text is the bundled module.
 */
export async function bundleWorkerSource(entryPoint: string): Promise<URL> {
  const { build } = await import(import.meta.resolve('esbuild')) as typeof Esbuild
  const { outputFiles } = await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: `node${process.versions.node}`,
    write: false,
    logLevel: 'silent',
    supported: { 'import-meta': false },
    logOverride: { 'empty-import-meta': 'error' },
    plugins: [pinImportMetaUrl],
  })
  const [bundle] = outputFiles
  /* v8 ignore next -- one entry point without code splitting always yields exactly one output file */
  if (bundle === undefined) throw new Error(`esbuild produced no output for ${entryPoint}`)
  return new URL(`data:text/javascript,${encodeURIComponent(bundle.text)}`)
}
