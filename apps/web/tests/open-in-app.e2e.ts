// Web e2e scenario: open-in-app. The session header's split button over the
// REAL host channel and the REAL loopback fence: the host resolves the
// catalog against a PATH this scenario owns, holding two stand-in launchers —
// `code` (an argv launch, VS Code) and `xdg-open` (the file manager's
// shell-open, offered because the scenario announces a display) — that record
// how they were started. The browser lists them, a pick from the menu launches
// the stand-in on the session's workspace directory, and the pick becomes the
// default. No model call: the session is seeded cold from a synthetic
// one-turn log. The stand-ins are POSIX shell scripts, so the scenario runs
// where the web lane does, on Linux and macOS.
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/open-in-app', import.meta.url))
const BUTTON_EXPECTED = join(SNAPSHOT_DIR, 'button.expected.md')
const MENU_EXPECTED = join(SNAPSHOT_DIR, 'menu.expected.md')
const MODE = webSnapshotMode()
const SEED_ID = 'open-in-app-web-e2e'

/** One stand-in launch: which launcher, its working directory, and its argv. */
interface Launch {
  readonly launcher: string
  readonly cwd: string
  readonly args: readonly string[]
}

let browser: Browser
let root: string
let scaffold: WebScaffold
let page: Page
let tripwire: ReturnType<typeof watchConsole>
let launches: string

/** Write one stand-in launcher that appends its name, cwd, and argv to the launch record. */
async function standIn(bin: string, name: string): Promise<void> {
  const path = join(bin, name)
  await writeFile(path, [
    '#!/bin/sh',
    `printf '%s\\t%s' ${JSON.stringify(name)} "$PWD" >> ${JSON.stringify(launches)}`,
    `for arg in "$@"; do printf '\\t%s' "$arg" >> ${JSON.stringify(launches)}; done`,
    `printf '\\n' >> ${JSON.stringify(launches)}`,
    '',
  ].join('\n'))
  await chmod(path, 0o755)
}

/** The launches recorded so far, oldest first. */
async function recorded(): Promise<Launch[]> {
  const text = await readFile(launches, 'utf8').catch(() => '')
  return text.split('\n').filter(line => line !== '').map((line) => {
    const [launcher = '', cwd = '', ...args] = line.split('\t')
    return { launcher, cwd, args }
  })
}

describe.skipIf(process.platform === 'win32')('web e2e: open-in-app split button', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'arx-open-in-app-e2e-'))
    const bin = join(root, 'bin')
    launches = join(root, 'launches.tsv')
    await mkdir(bin)
    await mkdir(join(root, 'xdg-empty'))
    await standIn(bin, 'code')
    await standIn(bin, 'xdg-open')
    // The host resolves the catalog against this process's environment, so the
    // scenario owns every input: PATH holds only the stand-ins (nothing the
    // machine happens to have installed can join the menu), a display is
    // announced so the file manager is offered, the XDG roots are empty, and
    // no SSH marker is inherited.
    vi.stubEnv('PATH', bin)
    vi.stubEnv('DISPLAY', ':99')
    vi.stubEnv('WAYLAND_DISPLAY', '')
    vi.stubEnv('XDG_DATA_HOME', join(root, 'xdg-empty'))
    vi.stubEnv('XDG_DATA_DIRS', join(root, 'xdg-empty'))
    vi.stubEnv('SSH_CONNECTION', '')
    vi.stubEnv('SSH_TTY', '')
    browser = await chromium.launch()
    scaffold = await launchWebScaffold({ openInApp: true })
    await seedSession(scaffold, createChatScrollFixture({
      markerPrefix: 'open-in-app', title: 'Open in app', turns: 1,
    }).log, SEED_ID)
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The sidebar tree collapses workspace groups by default: expand the group
    // row, then open the seeded session so its header renders.
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 30_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 30_000 })
    await sessionRow.click()
  }, 120_000)

  afterAll(async () => {
    await page?.context().close()
    await scaffold?.close()
    await browser?.close()
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  it('lists the resolved applications and launches a pick on the workspace directory', async () => {
    try {
      const split = page.locator('[data-open-in-app]')
      await split.waitFor({ timeout: 60_000 })
      await compareOrRefreshGolden(
        BUTTON_EXPECTED, await captureStableAria(page, '[data-open-in-app]', scaffold.workspaceCwd), MODE)

      await page.getByRole('button', { name: 'More ways to open', exact: true }).click()
      const menu = page.getByRole('menu')
      await menu.waitFor()
      await compareOrRefreshGolden(MENU_EXPECTED, await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd), MODE)

      await menu.getByRole('menuitem', { name: 'VS Code', exact: true }).click()
      await expect.poll(recorded, { timeout: 15_000 }).toEqual([
        { launcher: 'code', cwd: expect.any(String) as string, args: [scaffold.workspaceCwd] },
      ])
      // A successful pick becomes the default the main half opens.
      const main = page.getByRole('button', { name: 'Open in VS Code', exact: true })
      await main.waitFor()
      await main.click()
      await expect.poll(async () => (await recorded()).length, { timeout: 15_000 }).toBe(2)

      // The file manager opens the directory through the operating system's
      // open verb, which hands it the directory as its only argument.
      await page.getByRole('button', { name: 'More ways to open', exact: true }).click()
      await page.getByRole('menu').getByRole('menuitem', { name: 'Files', exact: true }).click()
      await expect.poll(async () => (await recorded()).at(-1), { timeout: 15_000 })
        .toEqual({ launcher: 'xdg-open', cwd: expect.any(String) as string, args: [scaffold.workspaceCwd] })
      await page.getByRole('button', { name: 'Open in Files', exact: true }).waitFor()

      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } catch (error) {
      await saveFailureShot(page, 'web-e2e-open-in-app')
      throw error
    }
  })
})
