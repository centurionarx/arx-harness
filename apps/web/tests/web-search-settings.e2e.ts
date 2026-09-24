// Shipped Web search onboarding through the real Loader, settings, credentials,
// providers, and browser. Only the reference-free opt-out scenario uses an
// overlay; the onboarding path must obtain its references from the bundle.
// Fake keys exercise local availability without a search or model request.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const REFERENCE_FREE_OVERLAY = fileURLToPath(new URL('./web-search-settings.overlay.yml', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/web-search-settings', import.meta.url))
const MODE = webSnapshotMode()

describe('web e2e: shipped Web search credential onboarding', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    // An operator's keys or pin must not configure this isolated keyless boot.
    for (const name of ['EXA_API_KEY', 'PERPLEXITY_API_KEY', 'ARX_WEB_SEARCH_PROVIDER']) {
      vi.stubEnv(name, undefined)
    }
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      try {
        await scaffold?.close()
      } finally {
        vi.unstubAllEnvs()
      }
    }
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
   * Open Web search after dismissing any existing settings dialog.
   * @param target - the shared page, or a scenario's isolated page.
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

  /**
   * Pin a settled settings milestone without exposing entered keys.
   * @param name - the milestone's golden basename.
   */
  async function snapshot(name: string): Promise<void> {
    const actual = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    expect(actual).not.toContain('exa-e2e-key')
    expect(actual).not.toContain('pplx-e2e-key')
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, name), actual, MODE)
  }

  it('boots keyless with writable credential fields for both shipped providers', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-web-search-shipped'))
    const dialog = await openWebSearch()
    const rows = dialog.getByRole('list')
    await rows.getByText('Exa', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await rows.getByText('Perplexity', { exact: true }).count()).toBe(1)
    await expect.poll(() => dialog.getByLabel('API key missing').count(), { timeout: 10_000 }).toBe(2)
    expect(await dialog.getByLabel('Not usable', { exact: true }).count()).toBe(2)
    expect(await dialog.getByLabel(/^API key for /).count()).toBe(2)
    for (const [provider, ref] of [['Exa', 'EXA_API_KEY'], ['Perplexity', 'PERPLEXITY_API_KEY']] as const) {
      const field = dialog.getByLabel('API key for ' + provider)
      expect(await field.isEnabled()).toBe(true)
      expect(await field.getAttribute('type')).toBe('password')
      expect(await field.getAttribute('placeholder')).toBe(ref)
      expect(await field.inputValue()).toBe('')
    }
    await expect.poll(() => dialog.getByRole('status').textContent(), { timeout: 10_000 })
      .toBe('No provider has a usable key; searches fail until one does.')
    expect(await dialog.getByLabel('Search provider').inputValue()).toBe('')
    expect(await credentialDocument()).toBe('')
    await snapshot('shipped.expected.md')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('stores a key in credentials and makes the sole usable provider automatic', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-web-search-key'))
    const dialog = await openWebSearch()
    const exaRow = dialog.locator('li').filter({ hasText: 'API key for Exa' })

    await dialog.getByLabel('API key for Exa').fill('exa-e2e-key')
    await exaRow.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(credentialDocument, { timeout: 10_000 }).toContain('EXA_API_KEY: exa-e2e-key')
    expect(await settingsDocument()).not.toContain('exa-e2e-key')
    expect(await settingsDocument()).not.toContain('searchProvider')
    await expect.poll(() => dialog.getByRole('status').textContent(), { timeout: 10_000 })
      .toBe('Searches run through Exa.')
    expect(await exaRow.getByLabel('Usable', { exact: true }).count()).toBe(1)
    expect(await exaRow.getByLabel('API key configured').count()).toBe(1)
    await expect.poll(() => dialog.getByLabel('API key for Exa').inputValue()).toBe('')
    expect(await dialog.getByLabel('Search provider').inputValue()).toBe('')
    await snapshot('usable.expected.md')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('requires a selection when both keys are stored and persists the chosen provider', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-web-search-pin'))
    const dialog = await openWebSearch()
    const perplexityRow = dialog.locator('li').filter({ hasText: 'API key for Perplexity' })

    await dialog.getByLabel('API key for Perplexity').fill('pplx-e2e-key')
    await perplexityRow.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(credentialDocument, { timeout: 10_000 }).toContain('PERPLEXITY_API_KEY: pplx-e2e-key')
    expect(await settingsDocument()).not.toContain('pplx-e2e-key')
    await expect.poll(() => dialog.getByRole('status').textContent(), { timeout: 10_000 })
      .toBe('More than one provider is usable; pin one.')
    expect(await dialog.getByLabel('Usable', { exact: true }).count()).toBe(2)
    expect(await dialog.getByLabel('Search provider').inputValue()).toBe('')
    await expect.poll(() => dialog.getByLabel('API key for Perplexity').inputValue()).toBe('')
    await snapshot('ambiguous.expected.md')

    await dialog.getByLabel('Search provider').selectOption('exa')
    await expect.poll(settingsDocument, { timeout: 10_000 }).toMatch(/web:\n\s+searchProvider: exa/)
    await expect.poll(() => dialog.getByRole('status').textContent(), { timeout: 10_000 })
      .toBe('Searches run through Exa.')
    expect(await dialog.getByLabel('Search provider').inputValue()).toBe('exa')
    await snapshot('selected.expected.md')

    await page.reload({ waitUntil: 'load' })
    const reloaded = await openWebSearch()
    await expect.poll(() => reloaded.getByRole('status').textContent(), { timeout: 10_000 })
      .toBe('Searches run through Exa.')
    expect(await reloaded.getByLabel('Search provider').inputValue()).toBe('exa')
    expect(await reloaded.getByLabel('API key configured').count()).toBe(2)
    expect(await reloaded.getByLabel('API key for Exa').inputValue()).toBe('')
    expect(await reloaded.getByLabel('API key for Perplexity').inputValue()).toBe('')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('removes a stored key without touching the pin', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-web-search-remove'))
    const dialog = await openWebSearch()
    const perplexityRow = dialog.locator('li').filter({ hasText: 'API key for Perplexity' })

    await perplexityRow.getByRole('button', { name: 'Remove key' }).click()
    await expect.poll(credentialDocument, { timeout: 10_000 }).not.toContain('PERPLEXITY_API_KEY: pplx-e2e-key')
    expect(await credentialDocument()).toContain('EXA_API_KEY: exa-e2e-key')
    expect(await settingsDocument()).toMatch(/web:\n\s+searchProvider: exa/)
    await expect.poll(() => perplexityRow.getByLabel('Not usable', { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    expect(await perplexityRow.getByLabel('API key missing').count()).toBe(1)
    await expect.poll(() => dialog.getByRole('status').textContent(), { timeout: 10_000 })
      .toBe('Searches run through Exa.')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('does not invent credential references when a deployment removes them', async () => {
    const referenceFree = await launchWebScaffold({ extraOverlayPath: REFERENCE_FREE_OVERLAY })
    const referenceFreePage = await newEnglishPage(browser)
    const referenceFreeTripwire = watchConsole(referenceFreePage)
    onTestFailed(() => saveFailureShot(referenceFreePage, 'web-e2e-web-search-reference-free'))
    try {
      await referenceFreePage.goto(referenceFree.baseUrl, { waitUntil: 'load' })
      await referenceFreePage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const dialog = await openWebSearch(referenceFreePage)
      await expect.poll(() => dialog.getByRole('status').textContent(), { timeout: 10_000 })
        .toBe('No provider has a usable key; searches fail until one does.')
      expect(await dialog.getByLabel('Not usable', { exact: true }).count()).toBe(2)
      expect(await dialog.getByLabel(/^API key for /).count()).toBe(0)
      expect(referenceFreeTripwire.pageErrors).toEqual([])
      expect(referenceFreeTripwire.warnings).toEqual([])
    } finally {
      await referenceFreePage.close()
      await referenceFree.close()
    }
  }, 120_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'shipped.expected.md', 'usable.expected.md', 'ambiguous.expected.md', 'selected.expected.md',
    ])
  })
})
