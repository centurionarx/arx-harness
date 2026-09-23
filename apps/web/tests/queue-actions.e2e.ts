// Keyless browser coverage for pending queue actions through the shipped Web
// composition and real HTTP/SSE wire. Replay overrides park consecutive turns
// so the page can edit and remove exact occurrences, then stop the active turn
// while proving the preserved Queue advances in FIFO order.
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed } from 'vitest'
import { deriveReplayScript, parseSessionLog, type ReplayEntry } from '@arx-ai/arx-llm-replay'
import type { SessionEvent } from '@arx-ai/arx-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/queue-actions', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./snapshots/live-interactions/session.jsonl', import.meta.url))
const COLLAPSED_EXPECTED = join(SNAPSHOT_DIR, 'collapsed.expected.md')
const EDITING_EXPECTED = join(SNAPSHOT_DIR, 'editing.expected.md')
const LAYOUT_EXPECTED = join(SNAPSHOT_DIR, 'layout.expected.md')
const PRESERVED_EXPECTED = join(SNAPSHOT_DIR, 'preserved.expected.md')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()

const ACTIVE_PROMPT = 'Reply with a one-sentence description of event sourcing, then stop.'
const REMOVE = 'Queue item to remove'
const EDIT = 'Queue item to edit'
const EDITED = 'Edited queue item'
const TAIL = 'Queue item preserved after stop'
const WAKE = 'Wake the preserved queue'

/** Durable turn-end classifications observed by the scenario. */
function turnEndReasons(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : [])
}

describe('web e2e: queue row actions', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let overrideDir: string | undefined

  afterEach(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    const closing = scaffold
    scaffold = undefined
    await closing?.close().catch((error: unknown) => failures.push(error))
    if (overrideDir !== undefined) {
      await rm(overrideDir, { recursive: true, force: true })
        .catch((error: unknown) => failures.push(error))
    }
    overrideDir = undefined
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'queue-actions teardown failed')
  })

  it.skipIf(MODE === 'record')('edits and removes exact occurrences and preserves Queue across stop', async () => {
    overrideDir = await mkdtemp(join(tmpdir(), 'arx-web-queue-actions-'))
    const readyFile = join(overrideDir, '.hang-ready')
    const overridePath = join(overrideDir, 'replay.override.json')
    const recorded = deriveReplayScript(parseSessionLog(await readFile(FIXTURE, 'utf8')))
    expect(recorded).toHaveLength(1)
    const replay: ReplayEntry[] = [
      { kind: 'hang', readyFile },
      recorded[0]!,
      recorded[0]!,
      recorded[0]!,
    ]
    await writeFile(overridePath, JSON.stringify(replay))

    const sessionEvents: SessionEvent[] = []
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayOverride: overridePath })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-queue-actions'))

    const input = page.locator('textarea').first()
    const firstSettled = scaffold.whenTurnSettled()
    await input.fill(ACTIVE_PROMPT)
    await input.press('Enter')
    await expect.poll(() => existsSync(readyFile), { timeout: 15_000 }).toBe(true)

    for (const text of [REMOVE, EDIT]) {
      await input.fill(text)
      await input.press('Enter')
    }
    const queueHeader = page.getByRole('button', { name: '2 queued messages' })
    await expect.poll(() => queueHeader.getAttribute('aria-expanded'), { timeout: 10_000 })
      .toBe('false')
    const collapsedSnapshot = await captureStableAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(COLLAPSED_EXPECTED, collapsedSnapshot, MODE)
    await queueHeader.click()
    await expect.poll(
      () => page.getByRole('button', { name: 'Remove queued message' }).count(),
      { timeout: 10_000 },
    ).toBe(2)

    await page.setViewportSize({ width: 640, height: 1000 })
    const composerMetrics = await page.locator('[data-composer-card]').evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        dockInset: Number.parseFloat(style.getPropertyValue('--arx-composer-dock-inset')),
      }
    })
    /**
     * The dock's inset on both sides. The narrow viewport re-insets it, so a
     * box read in the frame the viewport changed in catches the reflow partway
     * and lands a pixel or two off the token.
     * @returns left and right inset, or undefined while either box is absent.
     */
    const dockInsets = async (): Promise<{ left: number; right: number } | undefined> => {
      const queueBox = await page.locator('[data-queue-dock]').boundingBox()
      const composerBox = await page.locator('[data-composer-card]').boundingBox()
      if (queueBox === null || composerBox === null) return undefined
      return {
        left: queueBox.x - composerBox.x,
        right: composerBox.x + composerBox.width - queueBox.x - queueBox.width,
      }
    }
    await expect.poll(async () => (await dockInsets())?.left, { timeout: 10_000 })
      .toBeCloseTo(composerMetrics.dockInset, 1)
    const insets = await dockInsets()
    expect(insets).toBeDefined()
    expect(insets!.right).toBeCloseTo(composerMetrics.dockInset, 1)
    expect(insets!.left).toBeGreaterThanOrEqual(0)
    expect(insets!.right).toBeGreaterThanOrEqual(0)
    await page.setViewportSize({ width: 1680, height: 1000 })

    const editRow = page.getByText(EDIT, { exact: true }).locator('..')
    await editRow.getByRole('button', { name: 'Edit queued message' }).click()
    const editor = page.getByRole('textbox', { name: 'Edit queued message' })
    await editor.fill(EDITED)
    // The editing golden pins the Save tooltip. Hovering Save before the
    // capture makes the tooltip a precondition instead of an accident of where
    // the Edit click left the pointer, which raced the tooltip's open delay.
    // The click below lands on the same element, so the pointer path the later
    // goldens were recorded with is unchanged.
    const save = page.getByRole('button', { name: 'Save queued message' })
    await save.hover()
    await page.getByRole('tooltip', { name: 'Save queued message', exact: true }).waitFor()
    const editingSnapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(EDITING_EXPECTED, editingSnapshot, MODE)
    await save.click()
    await page.getByText(EDITED, { exact: true }).waitFor()

    const removeRow = page.getByText(REMOVE, { exact: true }).locator('..')
    await removeRow.getByRole('button', { name: 'Remove queued message' }).click()
    await expect.poll(() => page.getByText(REMOVE, { exact: true }).count()).toBe(0)

    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(sessionEvents.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toHaveLength(1)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])

    await input.fill(TAIL)
    await input.press('Enter')
    await expect.poll(
      () => page.getByRole('button', { name: 'Remove queued message' }).count(),
      { timeout: 10_000 },
    ).toBe(2)

    await page.getByRole('button', { name: 'Stop generating' }).click()
    await firstSettled
    await expect.poll(() => page.getByRole('button', { name: 'Stop generating' }).count())
      .toBe(0)
    await expect.poll(() => page.getByRole('button', { name: 'Remove queued message' }).count())
      .toBe(2)

    const preservedSnapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(PRESERVED_EXPECTED, preservedSnapshot, MODE)

    const settled = scaffold.whenTurnSettled()
    await input.fill(WAKE)
    await input.press('Enter')
    await settled
    await expect.poll(() => turnEndReasons(sessionEvents), { timeout: 15_000 })
      .toEqual(['aborted', 'completed', 'completed', 'completed'])
    expect(sessionEvents.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])).toEqual([ACTIVE_PROMPT, EDITED, TAIL, WAKE])
    await expect.poll(() => page.locator('[data-queue-dock]').count()).toBe(0)
  }, 120_000)

  it.skipIf(MODE === 'record')('orders Todo before Goal and Queue on one responsive card column', async () => {
    overrideDir = await mkdtemp(join(tmpdir(), 'arx-web-context-layout-'))
    const readyFile = join(overrideDir, '.hang-ready')
    const overridePath = join(overrideDir, 'replay.override.json')
    await writeFile(overridePath, JSON.stringify([{ kind: 'hang', readyFile } satisfies ReplayEntry]))

    const sessionEvents: SessionEvent[] = []
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayOverride: overridePath })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-context-layout'))

    const input = page.locator('textarea').first()
    const settled = scaffold.whenTurnSettled()
    await input.fill('/goal Keep the composer context panels aligned')
    await input.press('Enter')
    await expect.poll(() => existsSync(readyFile), { timeout: 15_000 }).toBe(true)
    await page.locator('[data-goal-bar]').waitFor({ timeout: 10_000 })

    const sessions = scaffold.ctx.sessions.list()
    expect(sessions).toHaveLength(1)
    sessions[0]!.append('todo/write', {
      todos: [
        { content: 'Confirm the panel order', status: 'completed' },
        { content: 'Align the panel widths', status: 'in_progress' },
      ],
    })
    await page.locator('[data-testid="todo-panel"]').waitFor({ timeout: 10_000 })

    for (const text of ['Layout queue first', 'Layout queue second']) {
      await input.fill(text)
      await input.press('Enter')
    }
    const queueHeader = page.getByRole('button', { name: '2 queued messages' })
    await expect.poll(() => queueHeader.getAttribute('aria-expanded'), { timeout: 10_000 })
      .toBe('false')

    const layoutSnapshot = await captureStableAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(LAYOUT_EXPECTED, layoutSnapshot, MODE)

    interface PanelGeometry { todo: DOMRect; goal: DOMRect; queue: DOMRect }
    /**
     * The three context panels measured in one frame. Read one at a time they
     * are a moving target — the panels re-column on a viewport change and the
     * dock animates in — so a spread computed across separate reads compares
     * two different layouts.
     * @returns the three rects, or undefined while any panel is absent.
     */
    const contextPanelGeometry = async (): Promise<PanelGeometry | undefined> =>
      page.evaluate(() => {
        const rect = (selector: string): DOMRect | undefined =>
          document.querySelector(selector)?.getBoundingClientRect()
        const todo = rect('[data-testid="todo-panel"]')
        const goal = rect('[data-goal-bar] > div')
        const queue = rect('[data-queue-dock] > div')
        if (todo === undefined || goal === undefined || queue === undefined) return undefined
        return { todo, goal, queue }
      })
    const panelSpread = (geometry: PanelGeometry | undefined): number | undefined =>
      geometry === undefined
        ? undefined
        : Math.max(
          Math.abs(geometry.todo.x - geometry.goal.x),
          Math.abs(geometry.todo.x - geometry.queue.x),
          Math.abs(geometry.todo.width - geometry.goal.width),
          Math.abs(geometry.todo.width - geometry.queue.width),
        )
    const expectAlignedContextPanels = async () => {
      await expect.poll(async () => panelSpread(await contextPanelGeometry()), { timeout: 10_000 })
        .toBeLessThan(0.05)
      const geometry = await contextPanelGeometry()
      expect(geometry).toBeDefined()
      expect(geometry!.todo.y).toBeLessThan(geometry!.goal.y)
      expect(geometry!.goal.y).toBeLessThan(geometry!.queue.y)
    }
    await expectAlignedContextPanels()
    await page.setViewportSize({ width: 640, height: 1000 })
    await expectAlignedContextPanels()
    await page.setViewportSize({ width: 1680, height: 1000 })

    await queueHeader.click()
    const removeButtons = page.getByRole('button', { name: 'Remove queued message' })
    await expect.poll(() => removeButtons.count(), { timeout: 10_000 }).toBe(2)
    await removeButtons.first().click()
    await expect.poll(() => removeButtons.count(), { timeout: 10_000 }).toBe(1)
    await removeButtons.first().click()
    await expect.poll(() => page.locator('[data-queue-dock]').count(), { timeout: 10_000 }).toBe(0)
    await page.getByRole('button', { name: 'Clear goal' }).click()
    await expect.poll(() => page.locator('[data-goal-bar]').count(), { timeout: 10_000 }).toBe(0)
    await page.getByRole('button', { name: 'Stop generating' }).click()
    await settled

    expect(turnEndReasons(sessionEvents)).toEqual(['aborted'])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(
      SNAPSHOT_DIR,
      ['collapsed.expected.md', 'editing.expected.md', 'layout.expected.md', 'preserved.expected.md', 'ui.expected.md'],
    )
  })
})
