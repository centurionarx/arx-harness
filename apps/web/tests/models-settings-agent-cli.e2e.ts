// Web e2e scenario: the Models page configures the CLI-backed subscription
// route through the shipped composition, where `llm-agent-cli` is mounted
// dormant. The route is offered by name, added with one model and its context
// window and no credential of any kind, and the model it lists reaches the
// composer's model selector. Zero model calls, and no CLI is ever spawned:
// nothing interrogates the CLI at mount or at save, and this scenario never
// asks the route to discover models.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/models-settings-agent-cli', import.meta.url))
const ADD_EXPECTED = join(SNAPSHOT_DIR, 'add.expected.md')
const CONFIGURED_EXPECTED = join(SNAPSHOT_DIR, 'configured.expected.md')
const MODE = webSnapshotMode()

// Model-access configuration: the route id and the name the plugin offers it
// under, and a model id a deployment would list for it.
const ROUTE = 'claude-subscription'
const ROUTE_NAME = 'Claude (subscription)'
const MODEL = 'claude-sonnet-5'

describe.skipIf(MODE === 'record')('web e2e: Models settings page configures the CLI-backed route', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
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

  it('offers the route by name and asks for no credential', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-agent-cli-add'))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Models' }).click()
    const add = dialog.getByRole('button', { name: 'Add provider' })
    await add.waitFor({ timeout: 10_000 })
    await expect.poll(async () => add.isEnabled(), { timeout: 10_000 }).toBe(true)
    await add.click()
    const pick = dialog.getByLabel('Provider')
    await pick.waitFor({ timeout: 10_000 })
    // Preselected by name, so the order the adapters registered in does not
    // decide which provider the card opens on.
    expect(await pick.inputValue()).toBe('amazon-bedrock')
    await pick.selectOption(ROUTE)

    await dialog.getByText('No API key is stored here.', { exact: false }).waitFor({ timeout: 10_000 })
    expect(await dialog.getByRole('textbox', { name: 'API key', exact: true }).count()).toBe(0)
    expect(await dialog.getByRole('textbox', { name: 'Base URL' }).count()).toBe(0)
    // A route that lists nothing serves nothing, so the card cannot apply yet.
    expect(await dialog.getByRole('button', { name: 'Apply', exact: true }).isEnabled()).toBe(false)
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(ADD_EXPECTED, snapshot, MODE)
  }, 60_000)

  it('adds one model with its context window and stores no credential', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-agent-cli-apply'))
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Add model' }).click()
    await dialog.getByLabel('Model ID 1', { exact: true }).fill(MODEL)
    await dialog.getByLabel('Context window 1', { exact: true }).fill('200K')
    await dialog.getByLabel('Accepts images 1', { exact: true }).check()
    const apply = dialog.getByRole('button', { name: 'Apply', exact: true })
    await expect.poll(async () => apply.isEnabled(), { timeout: 10_000 }).toBe(true)
    await apply.click()

    await dialog.getByRole('status').filter({ hasText: `Saved ${ROUTE_NAME}` }).waitFor({ timeout: 10_000 })
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    const section = document.slice(document.indexOf('llm-agent-cli:'))
    expect(section).toContain(`id: ${MODEL}`)
    expect(section).toContain('contextWindow: 200000')
    expect(section).toContain('acceptsImages: true')
    // The route signs in through the host CLI's own login: the page writes no
    // reference and stores no key.
    expect(section).not.toContain('apiKeyEnv')
    const credentials = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8').catch(() => '')
    expect(credentials).not.toContain('CLAUDE_SUBSCRIPTION')
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(CONFIGURED_EXPECTED, snapshot, MODE)
  }, 60_000)

  it('lists the model in the composer model selector', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-models-agent-cli-selector'))
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()
    // The composer's seats only exist once a workspace is connected.
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const trigger = page.getByRole('button', { name: /^Select model/ })
    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    await page.getByRole('menuitem', { name: /Model/ }).click()

    await page.getByRole('menuitemradio', { name: MODEL }).waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['add.expected.md', 'configured.expected.md'])
  })
})
