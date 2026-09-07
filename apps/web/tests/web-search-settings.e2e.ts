// Web e2e scenario: the Web search settings section end to end through the real
// wire. The shipped Web composition mounts both search providers dormant and
// names no credential reference for either, so the page it produces is two
// unusable rows over a seam that fails loud — the first scenario pins exactly
// that. A deployment that names the references (this file's overlay) makes the
// key form reachable: a key typed there reaches the credentials domain under the
// reference the provider's own settings section carries, never the settings
// document, and flips that provider to the one the seam resolves. A second key
// makes the choice ambiguous, and pinning one writes `web.searchProvider`.
// Zero model calls: this is settings, credentials, and web-domain traffic only,
// so there is no fixture and a stray stream would fail loud on the open llm seam.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

/** Names the credential reference on each shipped provider (see the file's header). */
const OVERLAY = fileURLToPath(new URL('./web-search-settings.overlay.yml', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/web-search-settings', import.meta.url))
const SHIPPED_EXPECTED = join(SNAPSHOT_DIR, 'shipped.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: Web search settings page configures the dormant providers', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
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

  /** The settings document as the Host has written it so far. */
  async function settingsDocument(): Promise<string> {
    return readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8').catch(() => '')
  }

  /** The credential file the harness home's credentials row writes. */
  async function credentialDocument(): Promise<string> {
    return readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8').catch(() => '')
  }

  /**
   * Open the settings dialog on the Web search section. The scenarios share one
   * page, so this leaves any dialog a previous scenario opened closed first —
   * its mask would otherwise swallow the trigger click.
   * @param target - the page to drive (the shared one unless a scenario owns another).
   * @returns the open settings dialog locator.
   */
  async function openWebSearch(target: Page = page) {
    if (await target.getByRole('dialog', { name: 'Settings' }).count() > 0) {
      await target.keyboard.press('Escape')
      await expect.poll(() => target.getByRole('dialog', { name: 'Settings' }).count(), { timeout: 5_000 }).toBe(0)
    }
    await target.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = target.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Web search', exact: true }).click()
    await dialog.getByRole('heading', { name: 'Web search' }).waitFor({ timeout: 10_000 })
    return dialog
  }

  it('offers no key field where the composition names no credential reference', async () => {
    // The shipped Web bundle mounts both providers with no config at all, so
    // neither settings section carries an `apiKeyEnv` and the page has nothing
    // to write a key under. It still reports the seam's own state, which is the
    // half a deployment cannot configure away.
    const shipped = await launchWebScaffold({})
    const shippedPage = await newEnglishPage(browser)
    const shippedTripwire = watchConsole(shippedPage)
    onTestFailed(() => saveFailureShot(shippedPage, 'web-e2e-web-search-shipped'))
    try {
      await shippedPage.goto(shipped.baseUrl, { waitUntil: 'load' })
      await shippedPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const dialog = await openWebSearch(shippedPage)

      // Scoped to the row list: each provider also names an option in the
      // selection control above it.
      const rows = dialog.getByRole('list')
      await rows.getByText('Exa', { exact: true }).waitFor({ timeout: 10_000 })
      expect(await rows.getByText('Perplexity', { exact: true }).count()).toBe(1)
      expect(await dialog.getByLabel('Not usable', { exact: true }).count()).toBe(2)
      expect(await dialog.getByLabel(/^API key for /).count()).toBe(0)

      // Nothing is usable, so the seam reports the failure rather than letting
      // composition order pick a provider.
      await expect.poll(() => dialog.getByRole('status').textContent(), { timeout: 10_000 })
        .toBe('No provider has a usable key; searches fail until one does.')
      expect(await dialog.getByLabel('Search provider').inputValue()).toBe('')

      const snapshot = await captureStableAria(shippedPage, '[role="dialog"]', shipped.workspaceCwd)
      await compareOrRefreshGolden(SHIPPED_EXPECTED, snapshot, MODE)
      expect(shippedTripwire.pageErrors).toEqual([])
      expect(shippedTripwire.warnings).toEqual([])
    } finally {
      await shippedPage.close()
      await shipped.close()
    }
  }, 120_000)

  it('stores a key under the provider reference and never in the settings document', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-web-search-key'))
    const dialog = await openWebSearch()
    const exaRow = dialog.locator('li').filter({ hasText: 'API key for Exa' })

    await expect.poll(() => dialog.getByLabel('API key for Exa').count(), { timeout: 10_000 }).toBe(1)
    expect(await dialog.getByLabel('API key missing').count()).toBe(2)
    await dialog.getByLabel('API key for Exa').fill('exa-e2e-key')
    await exaRow.getByRole('button', { name: 'Save', exact: true }).click()

    // The key lands in the harness home's credential file under the reference
    // the section names, and the settings document never sees the value.
    await expect.poll(credentialDocument, { timeout: 10_000 }).toContain('EXA_API_KEY: exa-e2e-key')
    expect(await settingsDocument()).not.toContain('exa-e2e-key')

    // The page reloads its join after the write: the provider it configured is
    // now usable, and it is the only one, so the seam resolves it with nothing
    // pinned.
    await expect.poll(() => dialog.getByRole('status').textContent(), { timeout: 10_000 })
      .toBe('Searches run through Exa.')
    expect(await dialog.getByLabel('Usable', { exact: true }).count()).toBe(1)
    expect(await dialog.getByLabel('API key configured').count()).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('reports two usable providers as ambiguous until one is pinned', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-web-search-pin'))
    const dialog = await openWebSearch()
    const perplexityRow = dialog.locator('li').filter({ hasText: 'API key for Perplexity' })

    await dialog.getByLabel('API key for Perplexity').fill('pplx-e2e-key')
    await perplexityRow.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(credentialDocument, { timeout: 10_000 }).toContain('PERPLEXITY_API_KEY: pplx-e2e-key')

    // Two usable providers and no pin: the seam refuses to choose.
    await expect.poll(() => dialog.getByRole('status').textContent(), { timeout: 10_000 })
      .toBe('More than one provider is usable; pin one.')

    await dialog.getByLabel('Search provider').selectOption('exa')
    await expect.poll(settingsDocument, { timeout: 10_000 }).toMatch(/web:\n\s+searchProvider: exa/)
    await expect.poll(() => dialog.getByRole('status').textContent(), { timeout: 10_000 })
      .toBe('Searches run through Exa.')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('removes a stored key without touching the pin', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-web-search-remove'))
    const dialog = await openWebSearch()
    const perplexityRow = dialog.locator('li').filter({ hasText: 'API key for Perplexity' })

    await perplexityRow.getByRole('button', { name: 'Remove key' }).click()
    await expect.poll(credentialDocument, { timeout: 10_000 }).not.toContain('PERPLEXITY_API_KEY: pplx-e2e-key')

    // The pin is settings state, not credential state: removing the other
    // provider's key leaves it exactly where the user put it.
    expect(await settingsDocument()).toMatch(/web:\n\s+searchProvider: exa/)
    await expect.poll(() => dialog.getByLabel('Usable', { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['shipped.expected.md'])
  })
})
