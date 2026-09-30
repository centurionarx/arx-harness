// Web e2e scenario: a browser asking for Brazilian Portuguese gets the
// composer and its pickers in Portuguese. The mode menu names the shipped
// presets, the model menu labels the effort levels the model declares, and the
// access menu names the shipped permission presets, all from the `pt`
// dictionaries; `<html lang>` names the regional variant. Connecting a
// workspace goes through the Portuguese directory dialog, and the sidebar
// names its controls, sessions, and view options in Portuguese. The command
// menu and the exit confirmation read Portuguese too.
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
 * Connect a fresh workspace from a Portuguese page: the hero trigger, the
 * directory dialog, and the unlocked composer read their `pt` copy.
 * @param page - the Portuguese page.
 * @param root - the scaffold's temp project parent.
 */
async function connectWorkspace(page: Page, root: string): Promise<void> {
  mkdirSync(join(root, 'workspace'), { recursive: true })
  await page.getByRole('textbox', { name: 'Escolher workspace' }).click()
  const dialog = page.getByRole('dialog', { name: 'Selecionar a pasta do workspace' })
  await dialog.waitFor({ timeout: 10_000 })
  await dialog.getByRole('button', { name: 'Editar o caminho' }).click()
  const pathInput = dialog.getByRole('textbox', { name: 'Editar o caminho' })
  await pathInput.fill(join(root, 'workspace'))
  await pathInput.press('Enter')
  await dialog.getByRole('button', { name: 'Abrir', exact: true }).click()
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

  it('names the sidebar controls, the session list, and its view options in Portuguese', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-portuguese-sidebar'))
    await page.getByRole('button', { name: 'Recolher a barra lateral' }).waitFor({ timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[role="tree"][aria-label="Sessões"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'sidebar.expected.md'), snapshot, MODE)
    await page.getByRole('button', { name: 'Opções de exibição' }).click()
    await page.getByRole('menu').waitFor({ timeout: 10_000 })
    const options = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'view-options.expected.md'), options, MODE)
    expect(options).toContain('Agrupar por')
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('opens the command menu and the exit confirmation in Portuguese', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-portuguese-commands'))
    await page.getByRole('button', { name: 'Comandos' }).click()
    await page.getByRole('listbox', { name: 'Sugestões' }).waitFor({ timeout: 10_000 })
    const menu = await captureStableAria(page, '[role="listbox"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'command-menu.expected.md'), menu, MODE)
    expect(menu).toContain('text: Comandos')
    await page.locator('textarea').first().press('Escape')
    await page.getByRole('button', { name: 'Sair', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Sair do arx Harness?' })
    await dialog.waitFor({ timeout: 10_000 })
    const confirm = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'exit-confirm.expected.md'), confirm, MODE)
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await expect.poll(() => dialog.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'access.expected.md', 'command-menu.expected.md', 'effort.expected.md', 'exit-confirm.expected.md',
      'modes.expected.md', 'sidebar.expected.md', 'view-options.expected.md',
    ])
  })
})
