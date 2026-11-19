// Web e2e scenario: a Host model selection that lands while a session's
// history is still loading reaches the composer. The client buffers live
// events during an open; when the history window it installs already contains
// a buffered `model/selection`, the live copy is a duplicate, and the client
// must still notify the picker once (packages/client/runtime/README.md,
// buffered selection decision). Before that rule the picker kept the old model
// until some unrelated refresh.
//
// The scenario holds the browser's `session.history` request, makes the
// selection through the real Host API while it is held, waits for the live
// frame to reach the browser, and only then releases the request, so the
// window the Host returns contains the selection. A Host selection also saves
// the default model, and a settings change reloads every picker; the default
// already names the picked model here, so that save changes nothing and the
// buffered-selection notification is the only path that can update the
// picker. No picker gesture, reload or model call can supply the update.
//
// Keyless in every mode, with no recording of its own: the cold seed is the
// seeded-history recording (its turn ran on DeepSeek V4 Flash, the route a
// fixture-less scaffold publishes), and the second model is an unreachable
// gateway declared in settings, as in declared-reasoning. No model call
// happens; record mode has nothing to record, so the suite skips it.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { settingsNamespace } from '@arx-ai/arx-settings'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionId } from '@arx-ai/arx-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { holdNextApiRequest, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/model-selection-during-open', import.meta.url))
const TRIGGER_EXPECTED = fileURLToPath(new URL('./snapshots/model-selection-during-open/trigger.expected.md', import.meta.url))
/** Recorded cold seed reused read-only; its turn selected DeepSeek V4 Flash. */
const SEED = fileURLToPath(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'model-selection-during-open-web-e2e'

describe.skipIf(MODE === 'record')('web e2e: a Host model selection during a session open reaches the composer', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let sessionId: SessionId
  const liveSelection = Promise.withResolvers<undefined>()

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await scaffold.ctx.settings.update(settingsNamespace('llm-pi-ai'), {
      providers: {
        'acme-gateway': {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [{ id: 'acme-think', name: 'Acme Think' }],
        },
      },
    })
    sessionId = await seedSession(scaffold, await readFile(SEED, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    // The downlink opens at boot: watch it from the start for the selection's live frame.
    page.on('websocket', (socket) => {
      socket.on('framereceived', (frame) => {
        if (typeof frame.payload === 'string' && frame.payload.includes('"model/selection"')) liveSelection.resolve(undefined)
      })
    })
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('refreshes the model trigger after a selection that the held history window already contains', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-model-selection-during-open'))
    // The saved default already names the model the Host selection picks, so its own default save is a no-op.
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-think' })
    const history = await holdNextApiRequest(page, 'session.history')
    // The sidebar tree collapses workspace groups by default: expand the group, then open the seeded session.
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await history.held
    // The picker reads the Host selection on its own; it shows the seed's model before the selection changes.
    const trigger = page.getByRole('button', { name: /^Select model/ })
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 15_000 }).toContain('DeepSeek-V4-Flash')

    const response = await scaffold.ctx.apiProxy.sessions.selectModel({
      rpcId: 'model-selection-during-open' as never,
      payload: { sessionId, provider: 'acme-gateway', model: 'acme-think' },
    })
    expect(response.result.ok).toBe(true)
    await liveSelection.promise
    // The open is still waiting for history, so the live frame is buffered, not shown.
    expect(await trigger.getAttribute('aria-label')).toContain('DeepSeek-V4-Flash')

    history.release()
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBe(1)
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 10_000 }).toContain('Acme Think')
    expect(await page.getByRole('menu').count()).toBe(0)
    const snapshot = await captureStableAria(page, 'button[aria-label^="Select model"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(TRIGGER_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['trigger.expected.md'])
  })
})
