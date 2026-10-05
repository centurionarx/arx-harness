/** Real Loader, generated Remote, renderer and native dialog evidence for the runnable repository example. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium, type Browser, type Page } from 'playwright'
import { installGithubFetchFixture } from '../../../examples/repository-inspection/github-fetch-fixture.ts'
import { expect, it } from 'vitest'
import type {} from '@arx-ai/arx-workspace'
import { credentialKey } from '@arx-ai/arx-credentials'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const run = promisify(execFile)
const EXAMPLE = fileURLToPath(new URL('../../../examples/repository-inspection/', import.meta.url))

const ACCOUNT_SELECTOR = '[role="dialog"] section[aria-label="GitHub"]'

/** Open the actual settings shell and require exactly one GitHub navigation contribution. */
async function openGithubSettings(page: Page, fromRepository = false) {
  await expect.poll(() => page.getByRole('button', { name: 'Settings' }).count()).toBe(1)
  await page.getByRole('button', { name: fromRepository ? 'Configure GitHub' : 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.waitFor()
  expect(await page.getByRole('button', { name: 'Settings' }).count()).toBe(1)
  const entry = settings.getByRole('button', { name: 'GitHub', exact: true })
  expect(await entry.count()).toBe(1)
  if (!fromRepository) await entry.click()
  expect(await entry.getAttribute('aria-current')).toBe('true')
  const account = settings.getByRole('region', { name: 'GitHub', exact: true })
  await account.waitFor()
  expect(await account.getByRole('combobox').count()).toBe(0)
  return { settings, account }
}

/** Snapshot all Git-owned files, including index bytes and write timestamps; paths are relative to the private repository. */
async function gitFiles(root: string, relative = '.git'): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name)
    if (entry.isDirectory()) Object.assign(result, await gitFiles(root, path))
    else {
      const metadata = await stat(join(root, path))
      result[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex') + ':' + String(metadata.mtimeMs)
    }
  }
  return result
}


/** Materialize actual Git/index/worktree state with fixed portable commit inputs. */
async function createGitFixture(root: string, branch = 'inspection', filename = 'example.txt') {
  await mkdir(root)
  const git = async (...args: string[]): Promise<string> => (await run('git', args, {
    cwd: root, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z', GIT_OPTIONAL_LOCKS: '0' },
  })).stdout
  await git('init', '--initial-branch=' + branch, '--object-format=sha1')
  await git('config', 'user.name', 'Repository Example')
  await git('config', 'user.email', 'repository@example.invalid')
  await git('config', 'core.autocrlf', 'false')
  await git('config', 'core.filemode', 'false')
  await writeFile(join(root, filename), 'base <tag> & value\n')
  await git('add', '--', filename)
  await git('commit', '-m', 'Example baseline')
  await writeFile(join(root, filename), 'prepared <script> & value\n')
  await git('add', '--', filename)
  await writeFile(join(root, filename), 'modified <img src=x onerror=alert(1)> & value\n')
  const prepared = await git('diff', '--cached', '--no-ext-diff', '--no-textconv', '--', filename)
  const modified = await git('diff', '--no-ext-diff', '--no-textconv', '--', filename)
  return { prepared, modified }
}

it('runs the repository example over real Git and wire with independent patches and native modal isolation', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: join(EXAMPLE, 'cordis.yml') })
  const external = installGithubFetchFixture()
  let browser: Browser | undefined
  try {
    const root = join(scaffold.workspaceCwd, 'inspection')
    const { prepared, modified } = await createGitFixture(root)
    expect(prepared).not.toBe(modified)
    const index = await readFile(join(root, '.git/index'))
    const before = await gitFiles(root)
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const consoleWatch = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    const region = page.getByRole('region', { name: 'Repository', exact: true })
    await region.waitFor({ timeout: 30_000 })
    const selector = region.locator('select[aria-label="Workspace"]')
    const github = region.getByRole('region', { name: 'GitHub', exact: true })
    expect(await github.getByRole('button', { name: 'Connect with PAT', exact: true }).count()).toBe(0)
    expect(await selector.locator('option').count()).toBe(1)
    const { settings, account } = await openGithubSettings(page)
    await account.getByRole('button', { name: 'Refresh', exact: true }).click()
    await account.getByText('Not configured. The operator must choose credential storage and isolation before a PAT can be accepted.', { exact: true }).waitFor()
    const authorize = account.getByRole('button', { name: 'Connect with PAT', exact: true })
    expect(await authorize.isDisabled()).toBe(true)
    await authorize.evaluate((element) => { (element as HTMLButtonElement).click() })
    expect(await page.getByRole('dialog', { name: 'GitHub personal access token', exact: true }).count()).toBe(0)
    expect(external.requests).toEqual([])
    const transcript = ['## GitHub settings without a registered workspace', await captureStableAria(page, ACCOUNT_SELECTOR, scaffold.workspaceCwd)]
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    await settings.waitFor({ state: 'hidden' })
    expect(await page.getByRole('button', { name: 'Settings' }).count()).toBe(1)
    const workspace = await scaffold.ctx.workspaceRegistry.create(root, 'Inspection example')
    await expect.poll(() => selector.locator('option').count()).toBe(2)
    expect(await selector.inputValue()).toBe('')
    expect(await region.getByText('Select a workspace to inspect its repository.').count()).toBe(1)
    transcript.push('## Before selection', await captureStableAria(page, 'section[aria-label="Repository"]', scaffold.workspaceCwd))
    await selector.selectOption(workspace.id)
    const staged = region.getByRole('button', { name: 'Prepared: example.txt', exact: true })
    const unstaged = region.getByRole('button', { name: 'Modified: example.txt', exact: true })
    await staged.waitFor({ timeout: 15_000 })
    await unstaged.waitFor()
    transcript.push('## Selected repository', await captureStableAria(page, 'section[aria-label="Repository"]', scaffold.workspaceCwd))
    for (const [button, patch, heading] of [[staged, prepared, 'Prepared comparison'], [unstaged, modified, 'Modified comparison']] as const) {
      await button.click()
      const dialog = page.getByRole('dialog', { name: 'Read-only comparison', exact: true })
      await dialog.waitFor()
      const pre = dialog.locator('pre')
      await expect.poll(() => pre.textContent()).toBe(patch)
      expect(patch.endsWith('\n')).toBe(true)
      expect(await pre.locator('script, img, tag').count()).toBe(0)
      expect(await dialog.evaluate(element => element instanceof HTMLDialogElement && element.matches(':modal'))).toBe(true)
      for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
        await page.keyboard.press(key)
        expect(await dialog.evaluate(element => element.contains(document.activeElement)), key + ': ' + await page.evaluate(() => document.activeElement?.tagName ?? 'none')).toBe(true)
      }
      await pre.focus()
      await selector.evaluate((element) => { (element as HTMLSelectElement).focus() })
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
      transcript.push('## ' + heading, await captureStableAria(page, 'dialog[open]', scaffold.workspaceCwd))
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      expect(await button.evaluate(element => document.activeElement === element)).toBe(true)
    }
    expect(await readFile(join(root, '.git/index'))).toEqual(index)
    expect(await gitFiles(root)).toEqual(before)
    expect(await readFile(join(root, 'example.txt'), 'utf8')).toBe('modified <img src=x onerror=alert(1)> & value\n')
    expect(consoleWatch.pageErrors).toEqual([])
    await compareOrRefreshGolden(join(EXAMPLE, 'repository.expected.md'), transcript.join('\n\n'), webSnapshotMode())
  } finally {
    try { await browser?.close() } finally {
      try { await scaffold.close() } finally { external.restore() }
      await expect(stat(scaffold.workspaceCwd)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(scaffold.persistenceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  }
})


it('keeps synthetic PAT authorization private while GitHub selection retargets the actual Git panel', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: join(EXAMPLE, 'github-record.overlay.yml') })
  const external = installGithubFetchFixture()
  let browser: Browser | undefined
  const sessionEvents: string[] = []
  const stopLog = scaffold.ctx.on('session/event', (_session, event) => { sessionEvents.push(JSON.stringify(event)) })
  try {
    const firstRoot = join(scaffold.workspaceCwd, 'inspection')
    const secondRoot = join(scaffold.workspaceCwd, 'retarget')
    await createGitFixture(firstRoot)
    const secondPatches = await createGitFixture(secondRoot, 'retarget', 'second.txt')
    const first = await scaffold.ctx.workspaceRegistry.create(firstRoot, 'Inspection example')
    const second = await scaffold.ctx.workspaceRegistry.create(secondRoot, 'Retarget example')
    const before = [await gitFiles(firstRoot), await gitFiles(secondRoot)]
    const indices = [await readFile(join(firstRoot, '.git/index')), await readFile(join(secondRoot, '.git/index'))]
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const consoleWatch = watchConsole(page)
    const inbound: string[] = [], outbound: string[] = []
    const httpBodies: Promise<string>[] = []
    page.on('websocket', (socket) => {
      socket.on('framereceived', frame => inbound.push(String(frame.payload)))
      socket.on('framesent', frame => outbound.push(String(frame.payload)))
    })
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) outbound.push(request.url() + ' ' + (request.postData() ?? ''))
    })
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.startsWith('/api/') && response.headers()['content-type']?.includes('application/json')) {
        httpBodies.push(response.text().catch(() => 'response unreadable'))
      }
    })
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    const region = page.getByRole('region', { name: 'Repository', exact: true })
    await region.waitFor({ timeout: 30_000 })
    const gitSelector = region.locator('select[aria-label="Workspace"]')
    const github = region.getByRole('region', { name: 'GitHub', exact: true })
    expect(await github.getByRole('button', { name: 'Connect with PAT', exact: true }).count()).toBe(0)
    const { settings, account } = await openGithubSettings(page, true)
    const accountRefresh = account.getByRole('button', { name: 'Refresh', exact: true })
    await accountRefresh.click()
    await account.getByText('Disconnected', { exact: true }).waitFor()
    const authorize = account.getByRole('button', { name: 'Connect with PAT', exact: true })
    await expect.poll(() => authorize.isEnabled()).toBe(true)
    expect(external.requests).toEqual([])
    expect(await gitSelector.inputValue()).toBe('')
    const transcript = ['## GitHub settings without a selected workspace', await captureStableAria(page, ACCOUNT_SELECTOR, scaffold.workspaceCwd)]
    await authorize.click()
    const dialog = page.getByRole('dialog', { name: 'GitHub personal access token', exact: true })
    const secret = dialog.getByLabel('Personal access token', { exact: true })
    await secret.waitFor()
    await expect.poll(() => secret.isEnabled()).toBe(true)
    expect(await secret.getAttribute('type')).toBe('password')
    expect(await dialog.evaluate(element => element instanceof HTMLDialogElement && element.matches(':modal'))).toBe(true)
    transcript.push('## Private PAT prompt', await captureStableAria(page, 'dialog[open]', scaffold.workspaceCwd))
    await secret.fill('cancelled-draft-never-submitted')
    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key)
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    }
    await secret.focus()
    await gitSelector.evaluate((element) => { (element as HTMLSelectElement).focus() })
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    expect(await settings.isVisible()).toBe(true)
    expect(await authorize.evaluate(element => document.activeElement === element)).toBe(true)
    expect(external.requests).toEqual([])
    await settings.getByRole('button', { name: 'General', exact: true }).click()
    expect(await settings.getByRole('region', { name: 'GitHub', exact: true }).count()).toBe(0)
    await settings.getByRole('button', { name: 'GitHub', exact: true }).click()
    await account.getByText('Disconnected', { exact: true }).waitFor()
    expect(await account.getByRole('combobox').count()).toBe(0)
    await authorize.click()
    await secret.waitFor()
    await expect.poll(() => secret.isEnabled()).toBe(true)
    expect(await secret.inputValue()).toBe('')
    await secret.fill(external.sentinel)
    await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.credentials.readRecord(credentialKey('github', 'account')))?.kind).toBe('api-key')
    await dialog.waitFor({ state: 'hidden' })
    expect(await settings.isVisible()).toBe(true)
    expect(await page.content()).not.toContain(external.sentinel)
    expect(await account.getByText('Connected', { exact: true }).count()).toBe(0)
    await accountRefresh.click()
    await account.getByText('Connected', { exact: true }).waitFor()
    expect(await account.getByText('example-reader', { exact: false }).count()).toBe(1)
    expect(await account.locator('li').count()).toBe(0)
    expect(external.requests).toEqual(['/user'])
    transcript.push('## Verified account without repository navigation', await captureStableAria(page, ACCOUNT_SELECTOR, scaffold.workspaceCwd))
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    await settings.waitFor({ state: 'hidden' })
    expect(await page.getByRole('button', { name: 'Settings' }).count()).toBe(1)
    const refresh = github.getByRole('button', { name: 'Refresh', exact: true })
    await refresh.click()
    await github.locator('li strong').filter({ hasText: 'example-reader/first' }).waitFor()
    expect(await github.locator('img, script').count()).toBe(0)
    expect(await github.getByText('Default branch: <img src=x onerror=alert(1)> & branch', { exact: true }).count()).toBe(1)
    const more = github.getByRole('button', { name: 'Load more', exact: true })
    expect(await more.isEnabled()).toBe(true)
    transcript.push('## First public metadata page', await captureStableAria(page, 'section[aria-label="Repository"] section[aria-label="GitHub"]', scaffold.workspaceCwd))
    await more.click()
    await github.locator('li strong').filter({ hasText: 'example-reader/second' }).waitFor()
    expect(await more.isDisabled()).toBe(true)
    expect(await github.getByText('Private', { exact: true }).count()).toBe(1)
    expect(external.requests).toEqual(['/user', '/user', '/user/repos?per_page=1&page=1&sort=full_name&direction=asc', '/user/repos?per_page=1&page=2&sort=full_name&direction=asc'])
    const githubWorkspace = github.getByRole('combobox', { name: 'Workspace', exact: true })
    const githubRepo = github.getByRole('combobox', { name: 'Repo', exact: true })
    expect(await gitSelector.inputValue()).toBe('')
    await gitSelector.selectOption(first.id)
    await region.getByRole('button', { name: 'Prepared: example.txt', exact: true }).waitFor()
    expect(await githubWorkspace.inputValue()).toBe(first.id)
    await githubRepo.selectOption('11')
    await githubWorkspace.selectOption(second.id)
    await expect.poll(() => gitSelector.inputValue()).toBe(second.id)
    await region.getByRole('button', { name: 'Prepared: second.txt', exact: true }).waitFor()
    expect(await region.getByRole('button', { name: 'Prepared: example.txt', exact: true }).count()).toBe(0)
    expect(await githubRepo.inputValue()).toBe('')
    await githubRepo.selectOption('12')
    transcript.push('## Pairing retargets the real Git owner', await captureStableAria(page, 'section[aria-label="Repository"]', scaffold.workspaceCwd))
    const source = region.getByRole('button', { name: 'Prepared: second.txt', exact: true })
    await source.click()
    const comparison = page.getByRole('dialog', { name: 'Read-only comparison', exact: true })
    await comparison.waitFor()
    await expect.poll(() => comparison.locator('pre').textContent()).toBe(secondPatches.prepared)
    expect(secondPatches.prepared.endsWith('\n')).toBe(true)
    await page.keyboard.press('Escape')
    await comparison.waitFor({ state: 'hidden' })
    expect(await source.evaluate(element => document.activeElement === element)).toBe(true)
    external.rejectCredential()
    await refresh.click()
    await github.getByText('Disconnected', { exact: true }).waitFor()
    const reopened = await openGithubSettings(page, true)
    expect(await reopened.account.getByRole('button', { name: 'Connect with PAT', exact: true }).isEnabled()).toBe(true)
    expect((await scaffold.ctx.credentials.readRecord(credentialKey('github', 'account')))?.kind).toBe('api-key')
    expect(external.requests.at(-1)).toBe('/user')
    expect(external.requests.length).toBe(5)
    transcript.push('## Rejected synthetic credential', await captureStableAria(page, ACCOUNT_SELECTOR, scaffold.workspaceCwd))
    expect(await gitFiles(firstRoot)).toEqual(before[0])
    expect(await gitFiles(secondRoot)).toEqual(before[1])
    expect(await readFile(join(firstRoot, '.git/index'))).toEqual(indices[0])
    expect(await readFile(join(secondRoot, '.git/index'))).toEqual(indices[1])
    expect(sessionEvents.join('\n')).not.toContain(external.sentinel)
    const sessions = scaffold.ctx.sessions.list().map(session => ({ header: session.header, events: session.events }))
    expect(JSON.stringify(sessions)).not.toContain(external.sentinel)
    const inboundHttp = await Promise.all(httpBodies)
    expect(inboundHttp).not.toContain('response unreadable')
    expect(JSON.stringify(consoleWatch)).not.toContain(external.sentinel)
    expect([...inbound, ...inboundHttp].join('\n')).not.toContain(external.sentinel)
    const privateAnswers = outbound.filter(message => message.includes(external.sentinel))
    expect(privateAnswers.length).toBe(1)
    expect(privateAnswers[0]).toContain('authorization.submit')
    const browserStorage = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))
    expect(browserStorage).not.toContain(external.sentinel)
    expect(browserStorage).not.toContain('cancelled-draft-never-submitted')
    expect(await page.content()).not.toContain('cancelled-draft-never-submitted')
    expect(outbound.join('\n')).not.toContain('cancelled-draft-never-submitted')
    expect(transcript.join('\n\n')).not.toContain(external.sentinel)
    expect(consoleWatch.pageErrors).toEqual([])
    await compareOrRefreshGolden(join(EXAMPLE, 'github.expected.md'), transcript.join('\n\n'), webSnapshotMode())
  } finally {
    stopLog()
    try { await browser?.close() } finally {
      try { await scaffold.close() } finally { external.restore() }
      await expect(stat(scaffold.workspaceCwd)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(scaffold.persistenceRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  }
})
