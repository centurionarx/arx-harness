// Real browser -> Remote -> storage-domain flow; no model calls.
import type {} from '@arx-ai/arx-project'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { assertFixtureInventory, captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/project-workspace', import.meta.url))
const MODE = webSnapshotMode()

describe('web e2e: project plans and prompt revisions', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleWatch: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    consoleWatch = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    try {
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    } catch (error) {
      await saveFailureShot(page, 'project-startup')
      console.error('Project startup:', consoleWatch.pageErrors, await page.locator('body').innerText())
      throw error
    }
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('creates and approves an exact plan, versions a prompt and reloads committed history', async () => {
    onTestFailed(() => saveFailureShot(page, 'project-workspace'))
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: 'Projects', exact: true })
    await dialog.getByLabel('Project name', { exact: true }).fill('Release review')
    await dialog.getByLabel('Workspace', { exact: true }).selectOption({ label: 'workspace' })
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click()
    await dialog.getByRole('heading', { name: 'Release review', exact: true }).waitFor()
    await dialog.getByLabel('Plan summary').fill('Ship reviewed orchestration')
    await dialog.getByLabel('Task title').fill('Validate the implementation')
    await dialog.getByLabel('Acceptance criteria (one per line)').fill('Regression checks pass')
    await dialog.getByRole('button', { name: 'Save new plan revision' }).click()
    await dialog.getByRole('button', { name: 'Approve this revision 1' }).click()
    await dialog.getByText('Approved revision: 1', { exact: true }).waitFor()
    await dialog.getByLabel('Prompt name', { exact: true }).fill('Review evidence')
    await dialog.getByLabel('Prompt content', { exact: true }).fill('Review the recorded tests and identify missing acceptance evidence.')
    await dialog.getByRole('button', { name: 'Save prompt revision' }).click()
    await expect.poll(() => dialog.getByLabel('Prompt library', { exact: true }).locator('option').count()).toBe(2)
    await dialog.getByLabel('Plan summary').fill('Follow-up with unchanged task identity')
    await dialog.getByRole('button', { name: 'Save new plan revision' }).click()
    await dialog.getByRole('button', { name: 'Approve this revision 2' }).waitFor()
    await dialog.getByText('Approved revision: 1', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    dialog = page.getByRole('dialog', { name: 'Projects', exact: true })
    await dialog.getByLabel('Choose a project', { exact: true }).selectOption({ label: 'Release review' })
    await dialog.getByRole('button', { name: 'Approve this revision 2' }).waitFor()
    await dialog.getByText('Approved revision: 1', { exact: true }).waitFor()
    await expect.poll(() => dialog.getByLabel('Prompt library', { exact: true }).locator('option').count()).toBe(2)
    await mkdir(join(REPO_ROOT, '.artifacts'), { recursive: true })
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/project-workspace.png'), fullPage: true })
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'ui.expected.md'), snapshot, MODE)
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
    // A saved schema using the service's dotted/hyphenated names remains editable.
    await dialog.getByLabel('Prompt library', { exact: true }).selectOption({ label: 'Review evidence' })
    await dialog.getByRole('button', { name: 'Add variable' }).click()
    await dialog.getByLabel('Variable name', { exact: true }).fill('release.target-name')
    expect(await dialog.getByLabel('Variable name', { exact: true }).evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true)
    await dialog.getByRole('button', { name: 'Save prompt revision' }).click()
    await expect.poll(() => dialog.getByLabel('Prompt library', { exact: true }).inputValue()).toBe('')
    await dialog.getByLabel('Prompt library', { exact: true }).selectOption({ label: 'Review evidence' })
    const promptSection = dialog.locator('section').filter({ has: page.getByRole('heading', { name: 'Prompt library', exact: true }) })
    await promptSection.getByText('Revision 2', { exact: true }).waitFor()
    await dialog.getByLabel('Prompt library', { exact: true }).selectOption('')
    await dialog.getByLabel('Prompt library', { exact: true }).selectOption({ label: 'Review evidence' })
    expect(await dialog.getByLabel('Variable name', { exact: true }).inputValue()).toBe('release.target-name')
    await dialog.getByRole('button', { name: 'Save prompt revision' }).click()
    await expect.poll(() => dialog.getByLabel('Prompt library', { exact: true }).inputValue()).toBe('')
    await dialog.getByLabel('Prompt library', { exact: true }).selectOption({ label: 'Review evidence' })
    await promptSection.getByText('Revision 3', { exact: true }).waitFor()
    const summary = dialog.getByLabel('Plan summary')
    await summary.fill('Uncommitted changes must not be approved')
    await expect.poll(() => dialog.getByRole('button', { name: 'Approve this revision 2' }).isDisabled()).toBe(true)
    await dialog.getByText('Save your changes as a new revision before approving this plan.').waitFor()
    await summary.fill('Follow-up with unchanged task identity')
    await expect.poll(() => dialog.getByRole('button', { name: 'Approve this revision 2' }).isDisabled()).toBe(false)
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
      await page.setViewportSize(viewport)
      const bounds = await dialog.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await page.screenshot({ path: join(REPO_ROOT, '.artifacts', 'project-workspace-' + String(viewport.width) + '.png') })
    }
    expect(consoleWatch.pageErrors).toEqual([])
  }, 120_000)
})
