// Real Web composition: a direct /name gesture loads an indexed skill body
// without publishing its description into the resident catalog or slash menu.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { ReplayOverrideDoc } from '@arx-ai/arx-llm-replay'
import { assertFixtureInventory, captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/skill-indexed-invoke', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()
const SKILL = 'indexed-invoke-demo'
const REPLY = 'INDEXED_INVOKE_REPLY acknowledged; indexed body received.'
const REPLAY: ReplayOverrideDoc = [{
  kind: 'chunks',
  chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: REPLY },
    { type: 'block-end', index: 0, block: { type: 'text', text: REPLY } },
    { type: 'usage', usage: { inputTokens: 256, outputTokens: 16 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ],
}]

describe.skipIf(MODE === 'record')('web e2e: index-only user skill invocation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let root: string
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'arx-indexed-skill-'))
    await mkdir(join(root, 'catalogo'), { recursive: true })
    await mkdir(join(root, SKILL), { recursive: true })
    await writeFile(join(root, 'catalogo', 'indice-skills.tsv'), `*${SKILL}\tmeta\tIndexed skill demo\n`)
    await writeFile(join(root, SKILL, 'SKILL.md'), [
      '---',
      `name: ${SKILL}`,
      'description: Indexed user gesture, absent from the resident catalog',
      'disable-model-invocation: true',
      '---', '', 'INDEXED_SKILL_BODY: reply with the fixture acknowledgement.', '',
    ].join('\n'))
    const replayOverride = join(root, 'replay.override.json')
    await writeFile(replayOverride, JSON.stringify(REPLAY))
    scaffold = await launchWebScaffold({
      replayFixture: join(root, 'override-only.jsonl'),
      replayOverride,
      indexedSkillRoot: root,
      paceMs: 10,
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('loads index-only content on a direct gesture without listing it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-skill-indexed-invoke'))
    const composer = page.locator('textarea:enabled').last()
    await composer.waitFor({ timeout: 15_000 })
    await composer.fill(`/${SKILL}`)
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
    expect(await menu.getByRole('option', { name: new RegExp(SKILL) }).count()).toBe(0)
    const settled = scaffold.whenTurnSettled()
    await composer.fill(`/${SKILL} please use the indexed instructions`)
    await composer.press('Enter')
    const injection = page.getByRole('button', { name: `Context injection ${SKILL}` })
    await injection.waitFor({ timeout: 20_000 })
    await injection.click()
    const body = page.locator('[data-context-injection-body]').filter({ hasText: `<skill_content name="${SKILL}">` })
    await body.waitFor({ timeout: 10_000 })
    expect(await body.textContent()).toContain('INDEXED_SKILL_BODY')
    await injection.click()
    await page.getByText('INDEXED_INVOKE_REPLY', { exact: false }).first().waitFor({ timeout: 20_000 })
    await settled
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  })
})
