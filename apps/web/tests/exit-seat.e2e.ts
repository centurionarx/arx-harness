// Web e2e scenario: the exit seat at the sidebar foot. Two facts only the
// assembled application can show: the row sits BELOW Settings — position is
// the shell's, not the occupant's, and a package test renders the occupant
// alone — and one real click carries the ask from the browser through the
// wire to `ctx.appExit`, the launcher's own exit request.
//
// The scaffold provides that request as a double which THROWS when called
// ("the web app requested exit 0 with no arguments to reject"), so the ask is
// answered by a failed response rather than a shutdown. The row lands on
// `Stopping…` either way, and deliberately so: after the ask, a client cannot
// tell a failed answer from the answer that raced the dying server, and the
// row must not claim the harness is still running while it may be going.
// Asserting the row rather than the transport keeps this scenario correct if
// the scaffold ever exits for real.
//
// The refusal path (`exit-unavailable`) needs a deployment with no exit
// request at all, which this scaffold is not; ui-exit's plugin spec owns it.
//
// Zero model calls: the seat is pure client plus one wire round trip on a
// blank frame, so there is no fixture and a stray stream would fail loud on
// the open llm seam.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, launchWebScaffold,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/exit-seat', import.meta.url))
const CONFIRM_EXPECTED = join(SNAPSHOT_DIR, 'confirm.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: the exit seat below Settings', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('seats Exit after Settings at the sidebar foot', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-exit-seat-order'))
    const settings = page.getByRole('button', { name: 'Settings', exact: true })
    const exit = page.getByRole('button', { name: 'Exit', exact: true })
    await expect.poll(async () => exit.count(), { timeout: 10_000 }).toBe(1)
    const settingsBox = (await settings.boundingBox())!
    const exitBox = (await exit.boundingBox())!
    expect(exitBox.y).toBeGreaterThan(settingsBox.y)
    // Same foot rhythm: the two rows share a left edge and a row height.
    expect(exitBox.x).toBe(settingsBox.x)
    expect(exitBox.height).toBe(settingsBox.height)
  })

  it('asks before it acts, and cancelling leaves the harness running', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-exit-seat-confirm'))
    await page.getByRole('button', { name: 'Exit', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Exit arx Harness?' })
    await dialog.waitFor({ timeout: 10_000 })
    await compareOrRefreshGolden(
      CONFIRM_EXPECTED,
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd),
      MODE,
    )
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect.poll(async () => dialog.count(), { timeout: 10_000 }).toBe(0)
    // Still serving: the surface answers a fresh navigation.
    expect((await page.request.get(scaffold.baseUrl)).status()).toBe(200)
  })

  it('carries one click through to the launcher exit request and stays stopping', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-exit-seat-stopping'))
    // The scaffold's exit double throws, so a failed answer comes back; the
    // browser hears that, and the response body names the ask that reached it.
    const answered = page.waitForResponse(
      async r => r.url().includes('/api') && (await r.text()).includes('requested exit 0'),
      { timeout: 15_000 },
    )
    await page.getByRole('button', { name: 'Exit', exact: true }).click()
    await page.getByRole('button', { name: 'Stop the server' }).click()
    await answered

    const row = page.getByRole('button', { name: 'Stopping…' })
    await row.waitFor({ timeout: 10_000 })
    expect(await row.isEnabled()).toBe(false)
    // The dialog is gone: there is nothing left to confirm or cancel.
    await expect.poll(async () => page.getByRole('dialog').count(), { timeout: 10_000 }).toBe(0)
  })

  it('keeps the fixture inventory exact', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['confirm.expected.md'])
  })
})
