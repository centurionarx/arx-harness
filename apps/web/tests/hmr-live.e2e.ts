/** Published arx web + pnpm dev:web → browser HMR, with no page reload. */

import { existsSync, globSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import type { Fiber } from '@arx-ai/cordis'
import LocalSubprocessRuntime from '@arx-ai/arx-subprocess-local'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'
import { readClientBuildRecord } from '../../../scripts/client-build-environment.ts'
import { REPO_ROOT } from './support.ts'

// The paths `readClientBuildRecord` digests. The check after restoration fails
// this test if the two lists drift apart.
const CLIENT_ARTIFACT_PATTERNS = [
  'apps/web/dist/**/*',
  'packages/*/*/lib/client.js',
  'packages/*/*/lib/client.js.map',
]

/** Return every artifact that `pnpm run dev:web` can rewrite. */
function clientArtifactPaths(): string[] {
  return globSync(CLIENT_ARTIFACT_PATTERNS, { cwd: REPO_ROOT })
    .map(path => join(REPO_ROOT, path))
    .filter(path => statSync(path).isFile())
    .sort()
}

function spawnSpec(argv: readonly string[], cwd: string, env?: Record<string, string>): SubprocessSpawnSpec {
  return {
    argv,
    cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: 5_000,
    ...env === undefined ? {} : { env },
  }
}

function waitForOutput(child: SubprocessHandle, pattern: RegExp, label: string): Promise<string> {
  return new Promise((resolveReady, reject) => {
    let output = ''
    let settled = false
    const cleanup = (): void => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
    }
    const resolveOnce = (value: string): void => {
      if (settled) return
      settled = true
      cleanup()
      resolveReady(value)
    }
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onData = (chunk: Buffer): void => {
      output += chunk.toString()
      const match = pattern.exec(output)
      if (match === null) return
      resolveOnce(match[1] ?? match[0])
    }
    // The hosted runner is still compiling the client packages at 60 s; the
    // case's own timeout below leaves room for the edit and reload after this.
    const timer = setTimeout(() => { rejectOnce(new Error(`${label} not ready:\n${output}`)) }, 150_000)
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    void child.done.then((outcome) => {
      rejectOnce(new Error(`${label} exited before ready (${JSON.stringify(outcome)}):\n${output}`))
    }, (error: unknown) => {
      rejectOnce(new Error(`${label} failed before ready:\n${output}`, { cause: error }))
    })
  })
}

async function stopTree(child: SubprocessHandle): Promise<void> {
  child.terminate()
  const stopped = await child.waitForExit(AbortSignal.timeout(15_000))
  if (!stopped) throw new Error(`process tree ${String(child.pid)} did not stop after termination escalation`)
  await child.done
}

it('hot-reloads a real client-plugin source edit without refreshing the page', async () => {
  const world = await mkdtemp(join(tmpdir(), 'arx-web-hmr-world-'))
  const sourcePath = join(REPO_ROOT, 'packages/client/ui-conversation/src/client/locales.ts')
  const binPath = join(REPO_ROOT, 'apps/cli/lib/bin.js')
  if (!existsSync(binPath)) throw new Error('HMR browser test needs the built arx bin; run pnpm run build first')
  const clientBuildEnvironment = readClientBuildRecord(REPO_ROOT).environment
  const originalClientArtifacts = await Promise.all(clientArtifactPaths()
    .map(async path => [path, await readFile(path)] as const))
  const originalClientArtifactPaths = new Set(originalClientArtifacts.map(([path]) => path))
  const originalSource = await readFile(sourcePath)
  // The workspace chip's accessible name is ui-conversation copy the
  // new-session screen renders in every build profile; the headline is brand
  // artwork in the official one.
  const oldText = 'Choose workspace'
  const sourceNeedle = "'hero.chooseWorkspace': 'Choose workspace'"
  const newText = `HMR UPDATED ${'x'.repeat(80)}`
  const updatedSource = originalSource.toString().replace(sourceNeedle, `'hero.chooseWorkspace': '${newText}'`)
  if (updatedSource === originalSource.toString()) throw new Error(`HMR source lacks ${JSON.stringify(sourceNeedle)}`)

  const subprocessCtx = new Context()
  let subprocessFiber: Fiber | undefined
  let watcher: SubprocessHandle | undefined
  let host: SubprocessHandle | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const failures: unknown[] = []
  try {
    subprocessFiber = await subprocessCtx.plugin(LocalSubprocessRuntime)
    watcher = subprocessCtx.subprocess.spawn(spawnSpec(
      ['pnpm', 'run', 'dev:web'],
      REPO_ROOT,
      { ...clientBuildEnvironment },
    ))
    await waitForOutput(watcher, /dev-web: watching/, 'pnpm run dev:web')
    host = subprocessCtx.subprocess.spawn(spawnSpec(
      [process.execPath, binPath, 'web', '--no-open', '--port', '0'],
      world,
      {
        DEEPSEEK_API_KEY: 'keyless-hmr-no-call',
        ARX_HOME: join(world, '.arx'),
      },
    ))
    const baseUrl = await waitForOutput(host, /arx web: (http:\/\/[^\s]+)/, 'built arx web')
    browser = await chromium.launch()
    const page = await browser.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(String(error)))
    await page.goto(baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: oldText, exact: true }).waitFor({ timeout: 15_000 })
    const pageIdentity = await page.evaluate(() => {
      const identity = crypto.randomUUID()
      Object.defineProperty(window, '__arxHmrPageIdentity', { value: identity })
      return identity
    })

    await writeFile(sourcePath, updatedSource)
    await page.getByRole('button', { name: newText, exact: true }).waitFor({ timeout: 30_000 })
    expect(await page.evaluate(() => (window as Window & { __arxHmrPageIdentity?: string }).__arxHmrPageIdentity))
      .toBe(pageIdentity)
    expect(pageErrors).toEqual([])
  } catch (error) {
    failures.push(error)
  } finally {
    await writeFile(sourcePath, originalSource).catch((error: unknown) => failures.push(error))
    if (watcher !== undefined) await stopTree(watcher).catch((error: unknown) => failures.push(error))
    if (host !== undefined) await stopTree(host).catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await subprocessFiber?.dispose().catch((error: unknown) => failures.push(error))
    // The watcher's vite stage rewrites apps/web/dist as well as the lib bundles,
    // and a rebuild cut short by the stop can leave files it added. Every later
    // consumer of the build record needs the tree `pnpm run build` recorded.
    await Promise.all(clientArtifactPaths()
      .filter(path => !originalClientArtifactPaths.has(path))
      .map(async (path) => { await rm(path, { force: true }) }))
      .catch((error: unknown) => failures.push(error))
    await Promise.all(originalClientArtifacts.map(async ([path, content]) => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content)
    })).catch((error: unknown) => failures.push(error))
    try {
      readClientBuildRecord(REPO_ROOT)
    } catch (error) {
      failures.push(error)
    }
    await rm(world, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
  }
  if (failures.length > 0) throw new AggregateError(failures, 'HMR browser test or cleanup failed')
}, 240_000)
