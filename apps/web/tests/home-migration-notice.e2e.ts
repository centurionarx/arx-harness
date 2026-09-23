// Web e2e scenario: the notice that tells a user their configuration was
// carried forward from the pre-rename home. The launcher reports the copy as a
// Host fact, so this scaffold reports one too; the notice renders the symbolic
// home names it carries and never an absolute path from the machine it ran on.
// The acknowledgement is keyed by the copy's own instant and stored through
// the settings API, so the same copy does not announce itself after a reload —
// which is the property that distinguishes this notice from the welcome one
// beside it. Zero model calls.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden,
  HOME_MIGRATION_NOTICE_COPY, launchWebScaffold, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/home-migration-notice', import.meta.url))
const NOTICE_EXPECTED = join(SNAPSHOT_DIR, 'notice.expected.md')

const MODE = webSnapshotMode()

// The symbolic names the launcher reports, never a machine path. The instant
// is fixed because the acknowledgement is compared against it: a moving value
// would make the same copy announce itself on every launch.
const MIGRATION = { fromDisplay: '~/.cxh', toDisplay: '~/.arx', at: '2026-09-22T09:15:00.000Z' }

describe.skipIf(MODE === 'record')('web e2e: home migration notice', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ homeMigration: MIGRATION })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('names both homes and stays acknowledged across a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-home-migration-notice'))
    const notice = page.getByRole('dialog', { name: HOME_MIGRATION_NOTICE_COPY.en.title })
    // It follows the welcome notice, which this scaffold pre-acknowledges, so
    // it is the first step with anything to show.
    await notice.waitFor({ timeout: 30_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)

    // The Host reports symbolic names and the notice prints those: a golden
    // carrying an absolute path would be a golden carrying someone's home.
    const body = await notice.textContent()
    expect(body).toContain('~/.cxh')
    expect(body).toContain('~/.arx')
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(NOTICE_EXPECTED, snapshot, MODE)

    await notice.getByRole('button', { name: HOME_MIGRATION_NOTICE_COPY.en.continueLabel }).click()
    await notice.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(
      () => page.locator('#root').evaluate(root => (root as HTMLElement).inert),
      { timeout: 15_000 },
    ).toBe(false)

    // Stored against the copy's instant through the loopback settings API, so
    // the reload finds it acknowledged rather than announcing the same copy.
    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    await page.waitForSelector('#root', { timeout: 30_000 })
    await expect.poll(() => notice.count(), { timeout: 15_000 }).toBe(0)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
