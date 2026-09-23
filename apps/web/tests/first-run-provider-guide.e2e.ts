// Web e2e scenario: a first run with no model provider it can use. The keyless
// lane boots the shipped composition with its adapters dormant, so the guide
// shows on the empty hero: it lists what the provider directory offers — the
// command-line subscription route by the name its plugin offers it under — and
// opens the Models page. Past the guide, the composer in a workspace says why it
// cannot send, and choosing it opens the same page. The dismissal is stored
// through the settings API, so a reload does not show the guide again. Zero
// model calls, and no CLI is spawned.
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, PROVIDER_GUIDE_COPY, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/first-run-provider-guide', import.meta.url))
const GUIDE_EXPECTED = join(SNAPSHOT_DIR, 'guide.expected.md')
const COMPOSER_EXPECTED = join(SNAPSHOT_DIR, 'composer.expected.md')
const MODE = webSnapshotMode()

/** The composer while no provider is set up: the trigger's name and its placeholder. */
const SET_UP = 'Set up a model provider'
const SET_UP_PLACEHOLDER = 'Set up a model provider to start'

describe.skipIf(MODE === 'record')('web e2e: first-run provider guide', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  /** The Models page inside the open settings panel. */
  const modelsPage = () => page.getByRole('dialog', { name: 'Settings' }).getByRole('heading', { name: 'Models', level: 2 })

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ missingModelCredential: true, providerGuidePending: true })
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

  it('lists what the directory offers and opens the Models page', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-first-run-provider-guide'))
    const guide = page.getByRole('dialog', { name: PROVIDER_GUIDE_COPY.en.title })
    // It follows the welcome notice, which this scaffold pre-acknowledges.
    await guide.waitFor({ timeout: 30_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)
    expect(await guide.textContent()).toContain('Claude (subscription)')
    await compareOrRefreshGolden(GUIDE_EXPECTED, await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), MODE)

    await guide.getByRole('button', { name: PROVIDER_GUIDE_COPY.en.open, exact: true }).click()
    await guide.waitFor({ state: 'detached', timeout: 15_000 })
    await modelsPage().waitFor({ timeout: 15_000 })
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'),
      { timeout: 10_000 },
    ).toContain('providerGuideVersion:')
  }, 60_000)

  it('turns the composer into the way to the Models page', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-first-run-provider-composer'))
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()
    mkdirSync(join(scaffold.workspaceCwd, 'workspace'), { recursive: true })
    await page.getByRole('textbox', { name: 'Choose workspace' }).click()
    const picker = page.getByRole('dialog', { name: 'Select Workspace Directory' })
    await picker.waitFor({ timeout: 10_000 })
    await picker.getByRole('button', { name: 'Edit path' }).click()
    const pathInput = picker.getByRole('textbox', { name: 'Edit path' })
    await pathInput.fill(join(scaffold.workspaceCwd, 'workspace'))
    await pathInput.press('Enter')
    await picker.getByRole('button', { name: 'Open', exact: true }).click()

    // Nothing serves a model, so there is nothing to select: the model seat
    // locks with the rest, and the card is the way to add a provider.
    const composer = page.getByRole('textbox', { name: SET_UP, exact: true })
    await composer.waitFor({ timeout: 15_000 })
    expect(await composer.getAttribute('placeholder')).toBe(SET_UP_PLACEHOLDER)
    expect(await composer.getAttribute('readonly')).not.toBeNull()
    await compareOrRefreshGolden(
      COMPOSER_EXPECTED, await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd), MODE)

    await composer.click()
    await modelsPage().waitFor({ timeout: 15_000 })
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()
  }, 60_000)

  it('does not show the dismissed guide again after a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-first-run-provider-reload'))
    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    // The composer answering again means the page has read its settings, and
    // with them the dismissal.
    await page.getByRole('textbox', { name: SET_UP, exact: true }).waitFor({ timeout: 30_000 })
    expect(await page.getByRole('dialog', { name: PROVIDER_GUIDE_COPY.en.title }).count()).toBe(0)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['composer.expected.md', 'guide.expected.md'])
  })
})
