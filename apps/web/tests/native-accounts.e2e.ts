// Web e2e scenario: the Models page's native accounts card through the shipped
// composition, with the native products replaced by the package's subprocess
// double. Claude Code and Codex read as signed out, and the Antigravity CLI,
// named by an absolute executable path, signs in by a pasted code and then
// lists its models without a chat route. Zero model calls; no native product
// process starts.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/native-accounts', import.meta.url))
const SIGNED_OUT_EXPECTED = join(SNAPSHOT_DIR, 'signed-out.expected.md')
const SIGNED_IN_EXPECTED = join(SNAPSHOT_DIR, 'signed-in.expected.md')
const SUBPROCESS_DOUBLE = fileURLToPath(new URL('../../../packages/credentials/native-accounts/tests/fixture/subprocess.ts', import.meta.url))
const CARD = 'section[aria-label="Native product accounts"]'
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: native accounts card signs in to the Antigravity CLI', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    // Any existing file stands in for the installed `agy`; the double answers every process it would start.
    scaffold = await launchWebScaffold({ nativeAccounts: { subprocess: SUBPROCESS_DOUBLE,
      config: { antigravityExecutable: process.execPath } } })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('lists the three native products signed out', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-native-accounts-signed-out'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Models' }).click()
    const card = page.locator(CARD)
    await card.getByText('Antigravity CLI', { exact: true }).waitFor({ timeout: 30_000 })
    await expect.poll(async () => card.getByText('Not connected', { exact: true }).count(), { timeout: 30_000 }).toBe(3)
    await compareOrRefreshGolden(SIGNED_OUT_EXPECTED, await captureStableAria(page, CARD, scaffold.workspaceCwd), MODE)
  }, 60_000)

  it('signs in to the Antigravity CLI with a pasted code and lists its models without a chat route', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-native-accounts-signed-in'))
    const card = page.locator(CARD)
    const row = card.locator('div[class*="rowCard"]').filter({ has: page.getByText('Antigravity CLI', { exact: true }) })
    await row.getByRole('button', { name: 'Connect in browser' }).click()
    await card.getByRole('link', { name: 'Open sign-in page' }).waitFor({ timeout: 10_000 })
    expect(await card.getByRole('link', { name: 'Open sign-in page' }).getAttribute('href'))
      .toBe('https://accounts.google.com/o/oauth2/auth?state=test-state')
    await card.getByLabel('Authorization code').fill('fixture-code')
    await card.getByRole('button', { name: 'Submit code' }).click()
    await card.getByText('Account connected.', { exact: true }).waitFor({ timeout: 30_000 })
    await row.getByText('Gemini 3 Pro', { exact: true }).waitFor({ timeout: 30_000 })
    expect(await row.getByRole('button', { name: 'Enable in chat' }).count()).toBe(0)
    await compareOrRefreshGolden(SIGNED_IN_EXPECTED, await captureStableAria(page, CARD, scaffold.workspaceCwd), MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['signed-in.expected.md', 'signed-out.expected.md'])
  })
})
