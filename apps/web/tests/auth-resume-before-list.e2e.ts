// Web e2e scenario (authenticated AUTH composition): Resume pressed before
// the runtime's aggregated session list has arrived waits for that list's
// pull and then opens the owned session; it creates no session. The HTTP
// project page lists the session before the runtime list does, so the
// scenario holds the browser's first `session.list` request, presses Resume
// while it is held, checks that nothing opened, and then releases it.
// The session is seeded without a model and the worker counts prove that no
// model or tool call ran. Keyless in every mode; record mode has nothing to
// record, so the suite skips it.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { assertFixtureInventory, compareOrRefreshGolden, webSnapshotMode } from './scaffold.ts'
import { launchAuthWebScaffold, openAuthPage, openOwnProject, sessionRow, signIn, type AuthWebScaffold } from './auth-scaffold.ts'
import { holdNextApiRequest, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/auth-resume-before-list', import.meta.url))
const FACTS_EXPECTED = fileURLToPath(new URL('./snapshots/auth-resume-before-list/facts.expected.md', import.meta.url))
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e (AUTH): Resume before the aggregated session list arrives', () => {
  let scaffold: AuthWebScaffold
  let browser: Browser
  let page: Page
  let pageErrors = 0

  beforeAll(async () => {
    scaffold = await launchAuthWebScaffold()
    browser = await chromium.launch()
    page = (await openAuthPage(browser, scaffold.fixture.url)).page
    page.on('pageerror', () => { pageErrors++ })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('waits for the held list, then opens the seeded session without creating one', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-auth-resume-before-list'))
    const seed = await scaffold.seed(0)
    const list = await holdNextApiRequest(page, 'session.list')
    await signIn(page, scaffold.fixture.users[0]!)
    await openOwnProject(page, seed.projectId)
    await list.held
    await sessionRow(page, seed.title).getByRole('button', { name: 'Retomar', exact: true }).click()
    // Nothing can open while the list is held; give a client that opens at once the time to show it.
    await page.waitForTimeout(1000)
    const openedWhileHeld = await page.getByText(/Resposta privada 0/).count() > 0

    list.release()
    await page.getByText('Registro próprio 0', { exact: true }).waitFor({ timeout: 30_000 })
    await page.getByText(/Resposta privada 0/).waitFor({ timeout: 30_000 })
    const counts = await scaffold.workerCounts()

    const facts = [
      '# Resume before the aggregated session list arrives',
      '',
      '- Session opened while the list was held: ' + String(openedWhileHeld),
      '- Seeded history visible after the list arrived: ' + String(await page.getByText(/Resposta privada 0/).count() === 1),
      '- Session rows in the project after Resume: ' + String(await page.locator('li').filter({ hasText: /^Conversa/ }).count()),
      '- Model calls / tool calls: ' + String(counts.modelCalls) + ' / ' + String(counts.toolCalls),
    ].join('\n')
    await compareOrRefreshGolden(FACTS_EXPECTED, facts, MODE)
    expect(pageErrors).toBe(0)
  }, 180_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['facts.expected.md'])
  })
})
