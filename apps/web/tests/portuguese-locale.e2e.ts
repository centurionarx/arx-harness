// Web e2e scenario: a browser asking for Brazilian Portuguese gets the
// composer and its pickers in Portuguese. The mode menu names the shipped
// presets, the model menu labels the effort levels the model declares, and the
// access menu names the shipped permission presets, all from the `pt`
// dictionaries; `<html lang>` names the regional variant. The workspace dialog
// ships English only, so connecting a workspace uses its English labels.
// Zero model calls: no replay fixture mounts, so a stray stream fails loud.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { settingsNamespace } from '@arx-ai/arx-settings'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot } from './support.ts'

/** Starts the Agent default on this scenario's declared reasoning model. */
const OVERLAY = fileURLToPath(new URL('./portuguese-locale.overlay.yml', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/portuguese-locale', import.meta.url))
/** The shipped roster, beside the composition that names it. */
const SHIPPED_PRESETS = fileURLToPath(new URL('../../cli/config/agent-presets', import.meta.url))
const MODE = webSnapshotMode()

/**
 * Connect a fresh workspace from a Portuguese page: the hero trigger and the
 * unlocked composer read the `pt` conversation copy, while the directory
 * dialog keeps its English labels.
 * @param page - the Portuguese page.
 * @param root - the scaffold's temp project parent.
 */
async function connectWorkspace(page: Page, root: string): Promise<void> {
  mkdirSync(join(root, 'workspace'), { recursive: true })
  await page.getByRole('textbox', { name: 'Escolher workspace' }).click()
  const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory' })
  await dialog.waitFor({ timeout: 10_000 })
  await dialog.getByRole('button', { name: 'Edit path' }).click()
  const pathInput = dialog.getByRole('textbox', { name: 'Edit path' })
  await pathInput.fill(join(root, 'workspace'))
  await pathInput.press('Enter')
  await dialog.getByRole('button', { name: 'Open', exact: true }).click()
  await page.locator('textarea:enabled[placeholder="Descreva o que você quer construir"]')
    .waitFor({ timeout: 15_000 })
}

describe.skipIf(MODE === 'record')('web e2e: the composer and its pickers in Brazilian Portuguese', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: OVERLAY,
      agentPresets: { roots: [{ path: SHIPPED_PRESETS, trust: 'system' }], default: 'standard' },
    })
    // Every shared effort id the vendor CLIs offer, so the pane shows each
    // Portuguese level label; the route sets no default, so it leads with the
    // provider-default entry.
    await scaffold.ctx.settings.update(settingsNamespace('llm-pi-ai'), {
      providers: {
        'acme-gateway': {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [{
            id: 'acme-think',
            name: 'Acme Think',
            reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
          }],
        },
      },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'pt-BR' })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens in Portuguese and names the regional variant in the document', async () => {
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('pt-BR')
  })

  it('names the shipped modes and what each composes in Portuguese', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-portuguese-modes'))
    await page.locator('[class*="heroWorkspaceRow"]').getByRole('button', { name: 'Modo padrão', exact: true }).click()
    await page.getByRole('menu').waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'modes.expected.md'), snapshot, MODE)
    expect(snapshot).toContain('Modo criador')
    await page.keyboard.press('Escape')
  })

  it('labels the declared effort levels in Portuguese', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-portuguese-effort'))
    const trigger = page.getByRole('button', { name: /^Selecionar modelo/ })
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 15_000 })
      .toBe('Selecionar modelo, atual: Acme Think, esforço de raciocínio Padrão')
    await trigger.click()
    await page.getByRole('menuitem', { name: /Esforço/ }).click()
    const levels = page.getByRole('menuitemradio')
    await expect.poll(async () => levels.allTextContents(), { timeout: 10_000 })
      .toEqual(['Padrão', 'Baixo', 'Médio', 'Alto', 'Extra', 'Máx'])
    const snapshot = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'effort.expected.md'), snapshot, MODE)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  })

  it('names the shipped access presets in Portuguese', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-portuguese-access'))
    await page.getByRole('button', { name: /^Modo de acesso, atual:/ }).click()
    await page.getByRole('menu').waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'access.expected.md'), snapshot, MODE)
    expect(snapshot).toContain('Acesso total')
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['access.expected.md', 'effort.expected.md', 'modes.expected.md'])
  })
})
