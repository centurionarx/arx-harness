/** Collect verified native client/boot execution and the exact recovery inline, without document/auth data. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { Page } from 'playwright'
import { NATIVE_RECOVERY_SCRIPT } from '../../../packages/client/modules/src/client/recovery-script.ts'

type ScriptCoverage = Awaited<ReturnType<Page['coverage']['stopJSCoverage']>>[number]
const bundles = new Map([
  ['/plugins/@arx-ai/arx-client-slots/client.js', 'packages/client/slots/lib/client.js'],
  ['/plugins/@arx-ai/arx-client-ui-auth/client.js', 'packages/client/ui-auth/lib/client.js'],
  ['/plugins/@arx-ai/arx-client-runtime/client.js', 'packages/client/runtime/lib/client.js'],
  ['/plugins/@arx-ai/arx-client-modules/client.js', 'packages/client/modules/lib/client.js'],
])
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
interface VerifiedCoverage {
  readonly bundle: string
  readonly source: string
  readonly sha256: string
  readonly sourceMapSha256: string
  readonly functions: ScriptCoverage['functions']
}

/** Execution recorder for real browser pages, with hashes of the actual published artifact and map. */
export class ClientCoverageRecorder {
  private readonly pages = new Set<Page>()
  private readonly entries: VerifiedCoverage[] = []
  private readonly recoveryInline: Array<{
    readonly source: string
    readonly sha256: string
    readonly functions: ScriptCoverage['functions']
  }> = []
  private readonly root = resolve('.')
  private readonly sourceBaseline = resolve('.gauntlet/evidence/AUTH-001-20261008/AUTH-GL3-20261009/frontend-source-baseline.json')

  /**
   * Start before navigation so every factory execution and reload remains measured.
   * @param page - Genuine Chromium page before its first navigation.
   * @returns After Chromium installs its execution collector.
   */
  async start(page: Page): Promise<void> {
    await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: true })
    this.pages.add(page)
  }

  /**
   * Stop a measured page before an explicit page/context close; retain only verified static scripts.
   * @param page - Real page previously admitted to this recorder; unmeasured pages are inert.
   * @returns After retaining measured ranges; an artifact mismatch rejects.
   */
  async stop(page: Page): Promise<void> {
    if (!this.pages.delete(page)) return
    for (const entry of await page.coverage.stopJSCoverage()) {
      if (entry.source === NATIVE_RECOVERY_SCRIPT) {
        this.recoveryInline.push({ source: entry.source, sha256: sha256(entry.source), functions: entry.functions })
        continue
      }
      if (entry.url === '') continue
      const pathname = new URL(entry.url).pathname
      const bundle = bundles.get(pathname)
        ?? (pathname.startsWith('/assets/') && pathname.endsWith('.js') ? 'apps/web/dist' + pathname : undefined)
      if (bundle === undefined) continue
      assert.ok(!relative(this.root, resolve(this.root, bundle)).startsWith('..'))
      const source = entry.source
      assert.equal(typeof source, 'string')
      assert.ok(source !== undefined)
      const artifact = await readFile(resolve(this.root, bundle))
      assert.equal(sha256(source), sha256(artifact), 'browser source differs from built artifact')
      this.entries.push({ bundle, source, sha256: sha256(artifact),
        sourceMapSha256: sha256(await readFile(resolve(this.root, bundle + '.map'))),
        functions: entry.functions })
    }
  }

  /**
   * Finish while pages remain live and save verified execution with separate raw-inline provenance.
   * @param output - Private fixture receipt directory within the authorized evidence tree.
   * @param completeness - Complete acceptance requires all original evidence; partial preserves real ranges after a functional failure.
   * @returns After byte verification and writing; mismatch rejects instead of claiming source coverage.
   */
  async finish(output: string, completeness: 'complete' | 'partial' = 'complete'): Promise<void> {
    const evidence = resolve('.gauntlet/evidence/AUTH-001-20261008')
    const outputPath = resolve(output)
    assert.ok(!relative(evidence, outputPath).startsWith('..'))
    const baselineBytes = await readFile(this.sourceBaseline, 'utf8')
    const baseline: unknown = JSON.parse(baselineBytes)
    assert.ok(typeof baseline === 'object' && baseline !== null && 'files' in baseline
      && Array.isArray(baseline.files))
    const files: readonly unknown[] = baseline.files
    for (const row of files) {
      assert.ok(typeof row === 'object' && row !== null && 'path' in row && 'sha256' in row
        && typeof row.path === 'string' && typeof row.sha256 === 'string')
      const source = resolve(this.root, row.path)
      assert.ok(!relative(this.root, source).startsWith('..'))
      assert.equal(sha256(await readFile(source)), row.sha256, 'source changed after build baseline')
    }
    for (const page of [...this.pages]) await this.stop(page)
    if (completeness === 'complete') {
      assert.ok(this.entries.length > 0, 'no measured static client bundle')
      assert.ok(this.recoveryInline.length > 0, 'no measured native recovery inline')
    }
    await writeFile(resolve(outputPath, 'client-browser-v8.json'), JSON.stringify({
      engine: 'chromium-v8', completeness, sourceBaseline: relative(this.root, this.sourceBaseline), sourceBaselineSha256: sha256(baselineBytes),
      scope: 'verified slots/ui-auth/runtime/modules and emitted Vite scripts; no inline HTML or auth data', entries: this.entries,
    }) + '\n')
    await writeFile(resolve(outputPath, 'client-recovery-inline-v8.json'), JSON.stringify({
      engine: 'chromium-v8', completeness, scope: 'exact recovery inline raw counters only; no TypeScript mapping or document URL',
      expectedSha256: sha256(NATIVE_RECOVERY_SCRIPT), entries: this.recoveryInline,
    }) + '\n')
  }
}
