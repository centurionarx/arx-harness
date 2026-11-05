/**
 * Real native project browser acceptance over two USERs and a separate MASTER origin.
 * Uses actual Loader, SDK, SQLite, broker, worker, tool-fs and replay; no auth override.
 * Receipts contain counts only. Cookies, bodies, credentials and WS payloads stay private.
 * Usage: native-project-browser-gate.host.ts <output> <evidence-root> <frontend-source-baseline>; output must lie inside evidence-root.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { BrowserContext, Page } from 'playwright'
import { browserFixture } from './browser-fixture.host.ts'
import { ClientCoverageRecorder } from './browser-coverage.host.ts'
import { browserHttp, type BrowserHttpResponse } from './browser-http.host.ts'
import { AUTH_HEADER, CSRF_HEADER, parseAuthState } from '@arx-ai/arx-web-identity/contract'
import { parseCreatedWorkspace, parseHistoryPage } from '@arx-ai/arx-project-storage/contract'
import { RpcId, clientRequestSchema, serverResponseSchema } from '@arx-ai/arx-host-apiproxy/api'
import { USER_PROJECT_BASE, USER_RUNTIME_FEATURES } from '../../../packages/client/modules/src/authenticated-graph.ts'
import { APPLICATION_PLUGIN_IDS } from '../../../packages/client/modules/src/client/manifest.ts'

const require = createRequire(resolve('apps/web/package.json'))
const { chromium } = require('playwright') as typeof import('playwright')
const [outputArg, evidenceRoot, sourceBaseline] = process.argv.slice(2)
if (!outputArg || !evidenceRoot || !sourceBaseline) throw new Error('usage: native-project-browser-gate.host.ts <output> <evidence-root> <frontend-source-baseline>')
const output = resolve(outputArg)
assert.ok(!relative(resolve(evidenceRoot), output).startsWith('..'))
await mkdir(output, { recursive: true })
let step = 'start actual project services'
const checks: Record<string, boolean | number> = {}
const fixture = await browserFixture('user', false, true, true)
const browser = await chromium.launch()
const contexts: BrowserContext[] = []
const clientCoverage = new ClientCoverageRecorder(evidenceRoot, sourceBaseline)
let coverageFinished = false
const traffic = new WeakMap<Page, { paths: string[]; frames: string[]; errors: number }>()
function watch(page: Page): void {
  const observed = { paths: [] as string[], frames: [] as string[], errors: 0 }
  traffic.set(page, observed)
  page.on('request', (request) => { observed.paths.push(new URL(request.url()).pathname) })
  page.on('pageerror', () => { observed.errors++ })
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => { observed.frames.push(typeof event.payload === 'string' ? event.payload : event.payload.toString('utf8')) })
  })
}
async function context(): Promise<BrowserContext> {
  const value = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 800 } })
  contexts.push(value)
  return value
}
async function page(ctx: BrowserContext, origin: string): Promise<Page> {
  const value = await ctx.newPage()
  watch(value)
  await clientCoverage.start(value)
  await value.goto(origin)
  return value
}
async function login(value: Page, identifier: string, password: string): Promise<void> {
  await value.getByLabel('Nome de usuário ou e-mail').fill(identifier)
  await value.getByLabel('Senha', { exact: true }).fill(password)
  await value.getByRole('button', { name: 'Entrar', exact: true }).click()
}
async function auth(ctx: BrowserContext, origin = fixture.url) {
  const response = await browserHttp(ctx, origin + '/auth/session')
  assert.equal(response.status(), 200)
  const state = parseAuthState(await response.json())
  assert.ok(state.authenticated)
  return state
}
function htmlGlobal(html: string, name: string): unknown {
  const prefix = '<script>globalThis[' + JSON.stringify(name) + '] = '
  const start = html.indexOf(prefix)
  assert.ok(start >= 0)
  return JSON.parse(html.slice(start + prefix.length, html.indexOf('</script>', start)))
}
async function index(ctx: BrowserContext, origin: string, kind: string, project: boolean): Promise<void> {
  const response = await browserHttp(ctx, origin)
  assert.equal(response.status(), 200)
  assert.equal(response.headers()['cache-control'], 'no-store')
  const html = await response.text()
  assert.ok(!html.includes('__ARX_FORBIDDEN_GLOBAL_CONFIG__'))
  assert.ok(!html.includes('csrfToken') && !html.includes('must-not-ship'))
  const marker = htmlGlobal(html, '__ARX_CLIENT_COMPOSITION__')
  assert.ok(typeof marker === 'object' && marker !== null && 'kind' in marker && 'audience' in marker)
  assert.equal(marker.kind, kind)
  assert.equal(marker.audience, origin === fixture.adminUrl ? 'admin' : 'user')
  const graph = htmlGlobal(html, '__ARX_BOOT__')
  assert.ok(typeof graph === 'object' && graph !== null && 'entries' in graph && Array.isArray(graph.entries))
  const entries = graph.entries.map((row: unknown) => {
    assert.ok(typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string')
    return row.id
  })
  assert.deepEqual(entries.sort(), [...(project ? [...USER_PROJECT_BASE, ...USER_RUNTIME_FEATURES] : APPLICATION_PLUGIN_IDS)].sort())
}
async function ownProjects(value: Page, projectId: string): Promise<void> {
  const select = value.getByRole('combobox', { name: 'Meus projetos' })
  const toggle = value.getByRole('button', { name: 'Meus projetos', exact: true })
  await select.or(toggle).first().waitFor()
  if (await select.count() === 0) await toggle.click()
  await select.selectOption(projectId)
}
function sessionRow(value: Page, title: string) {
  return value.locator('li').filter({ has: value.getByText(title, { exact: true }) })
}
async function rpc(ctx: BrowserContext, method: string, payload: unknown, origin = fixture.url) {
  const state = await auth(ctx, origin)
  const body = clientRequestSchema.parse({ type: 'client-request', rpcId: RpcId(randomUUID()), method, payload })
  return browserHttp(ctx, origin + '/api/' + method, { method: 'POST', headers: { [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken,
  }, data: body })
}
async function sessionResult(response: BrowserHttpResponse | import('playwright').Response): Promise<string> {
  assert.equal(response.status(), 200)
  const result = serverResponseSchema.parse(await response.json()).result
  assert.ok(result.ok)
  assert.ok(typeof result.value === 'object' && result.value !== null && 'sessionId' in result.value && typeof result.value.sessionId === 'string')
  return result.value.sessionId
}
function noForeign(value: Page, secret: string): void {
  assert.ok(!(traffic.get(value)?.frames ?? []).some(frame => frame.includes(secret)), 'foreign event reached another owner')
}
try {
  step = 'anonymous and MASTER never materialize project graph'
  assert.ok(fixture.adminUrl)
  const ctxA = await context(), ctxB = await context(), ctxMaster = await context()
  await index(ctxA, fixture.url, 'public', false)
  const a = await page(ctxA, fixture.url)
  await a.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  assert.ok(!(traffic.get(a)?.paths ?? []).some(path => path.startsWith('/api/')))
  const master = await page(ctxMaster, fixture.adminUrl)
  await login(master, 'arxadmin', fixture.masterPassword)
  await master.getByRole('heading', { name: 'MASTER-ADMIN' }).waitFor()
  await index(ctxMaster, fixture.adminUrl, 'admin', false)
  assert.ok(!(traffic.get(master)?.paths ?? []).some(path => path.startsWith('/api/') || path === '/events'))
  assert.equal((await rpc(ctxMaster, 'host.describe', {}, fixture.adminUrl)).status(), 403)
  assert.equal((await browserHttp(ctxMaster, fixture.adminUrl + '/user/projects')).status(), 403)
  checks.publicAdminNoProjectFactories = true

  step = 'two USER project boots and cold resume without execution'
  const seedA = await fixture.command('seed-history', { index: 0 })
  const seedB = await fixture.command('seed-history', { index: 1 })
  for (const seed of [seedA, seedB]) for (const key of ['projectId', 'workspaceId', 'sessionId']) assert.equal(typeof seed[key], 'string')
  await login(a, fixture.users[0]!.username, fixture.users[0]!.password)
  const b = await page(ctxB, fixture.url)
  await login(b, fixture.users[1]!.username, fixture.users[1]!.password)
  await ownProjects(a, String(seedA.projectId))
  await ownProjects(b, String(seedB.projectId))
  await index(ctxA, fixture.url, 'user', true)
  await index(ctxB, fixture.url, 'user', true)
  await sessionRow(a, 'Conversa privada 0').getByRole('button', { name: 'Retomar', exact: true }).click()
  await a.getByText('Registro próprio 0', { exact: true }).waitFor()
  await a.getByText(/Resposta privada 0/).waitFor()
  await sessionRow(b, 'Conversa privada 1').getByRole('button', { name: 'Retomar', exact: true }).click()
  await b.getByText('Registro próprio 1', { exact: true }).waitFor()
  await b.getByText(/Resposta privada 1/).waitFor()
  const initialCounts = await fixture.command('worker-counts')
  assert.equal(initialCounts.modelCalls, 0)
  assert.equal(initialCounts.toolCalls, 0)
  assert.equal(await b.getByText('Registro próprio 0', { exact: true }).count(), 0)
  for (const secret of [String(seedA.sessionId), String(seedA.workspaceId), 'Registro próprio 0']) noForeign(b, secret)
  assert.equal((await rpc(ctxB, 'session.create', { workspaceId: seedA.workspaceId, sessionId: seedA.sessionId })).status(), 403)
  assert.equal((await rpc(ctxB, 'session.fork', { sessionId: seedA.sessionId })).status(), 403)
  assert.equal((await browserHttp(ctxB, fixture.url + '/user/sessions/' + String(seedA.sessionId) + '/history')).status(), 403)
  checks.twoUserRealWorkerColdResume = true
  checks.foreignRpcAndEventsDenied = true

  step = 'account focus and Escape use the same application slot API'
  const account = a.getByRole('button', { name: 'Minha conta', exact: true })
  await account.click()
  const dialog = a.getByRole('dialog', { name: 'Minha conta' })
  await dialog.waitFor()
  assert.ok((await dialog.textContent())?.includes(fixture.users[0]!.username))
  const firstControl = dialog.getByRole('button', { name: 'Fechar', exact: true })
  assert.equal(await firstControl.evaluate(node => node === document.activeElement), true)
  await a.keyboard.press('x')
  assert.equal(await firstControl.evaluate(node => node === document.activeElement), true)
  await firstControl.focus()
  await a.keyboard.press('Shift+Tab')
  assert.equal(await dialog.getByRole('button', { name: 'Sair', exact: true }).evaluate(node => node === document.activeElement), true)
  await a.keyboard.press('Tab')
  assert.equal(await dialog.getByRole('button', { name: 'Fechar', exact: true }).evaluate(node => node === document.activeElement), true)
  await a.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await account.evaluate(node => node === document.activeElement), true)
  await account.click()
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await account.evaluate(node => node === document.activeElement), true)
  checks.accountFocusRestored = true
  for (const width of [360, 768, 1440]) {
    await a.setViewportSize({ width, height: 900 })
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await account.waitFor()
    await account.focus(); await a.keyboard.press('Enter')
    await dialog.waitFor()
    assert.equal(await firstControl.evaluate(node => node === document.activeElement), true)
    await a.keyboard.press('Shift+Tab')
    assert.equal(await dialog.getByRole('button', { name: 'Sair', exact: true }).evaluate(node => node === document.activeElement), true)
    await a.keyboard.press('Tab')
    assert.equal(await firstControl.evaluate(node => node === document.activeElement), true)
    await a.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await account.evaluate(node => node === document.activeElement), true)
  }
  await a.setViewportSize({ width: 1280, height: 800 })
  checks.projectViewportWidths = 3

  step = 'new owner workspace uses server-allocated session ID'
  const created = a.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/user/projects/' + String(seedA.projectId) + '/workspaces')
  await a.getByLabel('Nome do workspace').fill('Workspace criado no navegador')
  await a.getByRole('button', { name: 'Criar workspace', exact: true }).click()
  const createdResponse = await created
  assert.equal(createdResponse.status(), 201)
  const workspace = parseCreatedWorkspace(await createdResponse.json())
  await fixture.command('assign-workspace', { index: 0, workspaceId: workspace.workspaceId })
  const opened = a.waitForResponse(response => new URL(response.url()).pathname === '/api/session.create'
    && response.request().method() === 'POST')
  await a.locator('li').filter({ has: a.getByText('Workspace criado no navegador', { exact: true }) })
    .getByRole('button', { name: 'Abrir workspace', exact: true }).click()
  const openedResponse = await opened
  const request = clientRequestSchema.parse(openedResponse.request().postDataJSON())
  assert.ok(typeof request.payload === 'object' && request.payload !== null && 'workspaceId' in request.payload)
  assert.equal(request.payload.workspaceId, workspace.workspaceId)
  assert.ok(!('cwd' in request.payload) && !('sessionId' in request.payload))
  const newSessionId = await sessionResult(openedResponse)
  assert.notEqual(newSessionId, String(seedA.sessionId))
  const ownHistory = await browserHttp(ctxA, fixture.url + '/user/sessions/' + newSessionId + '/history')
  assert.equal(ownHistory.status(), 200)
  assert.equal((await browserHttp(ctxB, fixture.url + '/user/sessions/' + newSessionId + '/history')).status(), 403)
  assert.ok([403, 404].includes((await rpc(ctxA, 'session.create', { workspaceId: randomUUID() })).status()))
  checks.newWorkspaceRealSessionOpen = true

  step = 'fork retains own durable history without execution'
  await ownProjects(a, String(seedA.projectId))
  const forked = a.waitForResponse(response => new URL(response.url()).pathname === '/api/session.fork')
  await sessionRow(a, 'Conversa privada 0').getByRole('button', { name: 'Criar ramificação', exact: true }).click()
  const forkId = await sessionResult(await forked)
  assert.notEqual(forkId, String(seedA.sessionId))
  assert.equal((await browserHttp(ctxA, fixture.url + '/user/sessions/' + forkId + '/history')).status(), 200)
  assert.equal((await browserHttp(ctxB, fixture.url + '/user/sessions/' + forkId + '/history')).status(), 403)
  const forkCounts = await fixture.command('worker-counts')
  assert.equal(forkCounts.modelCalls, 0)
  assert.equal(forkCounts.toolCalls, 0)
  checks.ownForkWithoutModelExecution = true

  step = 'real replay tool write and opaque current-file preview'
  await sessionRow(a, 'Conversa privada 0').getByRole('button', { name: 'Retomar', exact: true }).click()
  await a.getByText('Registro próprio 0', { exact: true }).waitFor()
  const replay = await fixture.command('configure-preview-replay', { workspaceId: seedA.workspaceId, sessionId: seedA.sessionId })
  assert.equal(replay.configured, true)
  const selected = await rpc(ctxA, 'session.selectModel', { sessionId: seedA.sessionId, provider: replay.provider, model: replay.model })
  assert.equal(selected.status(), 200)
  const selectedResult = serverResponseSchema.parse(await selected.json()).result
  assert.ok(selectedResult.ok)
  const composer = a.locator('textarea:visible')
  assert.equal(await composer.count(), 1)
  await composer.fill('Create the owned preview fixture.')
  await composer.press('Enter')
  await a.getByText(/Preview fixture ready:/).waitFor()
  const consumed = await fixture.command('finish-preview-replay', { workspaceId: seedA.workspaceId, sessionId: seedA.sessionId })
  assert.equal(consumed.consumed, true)
  assert.equal(consumed.modelCalls, 2)
  assert.equal(consumed.toolCalls, 1)
  await a.getByRole('button').filter({ hasText: 'malicious.html' }).last().click()
  const frameElement = a.locator('iframe[title="Prévia do HTML"]')
  await frameElement.waitFor()
  assert.equal(await frameElement.getAttribute('sandbox'), '')
  assert.equal(await frameElement.getAttribute('referrerpolicy'), 'no-referrer')
  const preview = a.frameLocator('iframe[title="Prévia do HTML"]')
  await preview.getByRole('heading', { name: 'Own opaque preview' }).waitFor()
  const isolation = await preview.locator('html').evaluate(async () => {
    let parentDomBlocked = false, parentStorageBlocked = false, fetchBlocked = false
    try { void parent.document.body } catch { parentDomBlocked = true }
    try { void parent.localStorage.length } catch { parentStorageBlocked = true }
    try { await fetch('/auth/session', { credentials: 'include' }) } catch { fetchBlocked = true }
    parent.postMessage({ method: 'host.pickDirectory', type: 'arx-auth-required' }, '*')
    return { origin: globalThis.origin, parentDomBlocked, parentStorageBlocked, fetchBlocked,
      bridge: '__ARX_TRANSPORT__' in globalThis }
  })
  assert.deepEqual(isolation, { origin: 'null', parentDomBlocked: true, parentStorageBlocked: true, fetchBlocked: true, bridge: false })
  assert.equal(await a.evaluate(() => '__ARX_PREVIEW_ATTACK__' in globalThis || localStorage.getItem('arx.preview.attack') !== null), false)
  assert.equal(await a.getByRole('button', { name: 'Abrir no aplicativo do sistema', exact: true }).count(), 0)
  assert.equal((await auth(ctxA)).principal.username, fixture.users[0]!.username)
  for (const secret of [String(seedA.sessionId), 'Preview fixture ready:', 'owned-browser-preview']) noForeign(b, secret)
  checks.realReplayConsumed = true
  checks.opaquePreviewParentAndAuthDenied = true

  step = 'real question response stays in the owner worker'
  const asked = await fixture.command('ask-question', { workspaceId: seedA.workspaceId, sessionId: seedA.sessionId })
  assert.equal(asked.pending, true)
  const question = a.locator('[data-question-key]')
  await question.getByText('Choose the owned result', { exact: true }).waitFor()
  assert.equal(await b.getByText('Choose the owned result', { exact: true }).count(), 0)
  const answered = a.waitForResponse(response => new URL(response.url()).pathname === '/api/respond')
  await question.getByRole('radio', { name: 'Continue', exact: true }).click()
  await question.getByRole('radio', { name: 'Continue', exact: true }).press('Enter')
  assert.equal((await answered).status(), 200)
  await question.waitFor({ state: 'detached' })
  noForeign(b, 'owner-choice')
  checks.realQuestionOwnerResponse = true

  step = 'cold restart preserves raw history and does not execute a model'
  const bytesBefore = await (await browserHttp(ctxA, fixture.url + '/user/sessions/' + String(seedA.sessionId) + '/export')).body()
  const countsBefore = await fixture.command('worker-counts')
  await fixture.command('restart-workers')
  await a.reload()
  await ownProjects(a, String(seedA.projectId))
  await sessionRow(a, 'Conversa privada 0').getByRole('button', { name: 'Retomar', exact: true }).click()
  await a.getByText(/Preview fixture ready:/).waitFor()
  const bytesAfter = await (await browserHttp(ctxA, fixture.url + '/user/sessions/' + String(seedA.sessionId) + '/export')).body()
  assert.deepEqual(bytesAfter, bytesBefore)
  const countsAfter = await fixture.command('worker-counts')
  assert.equal(countsAfter.modelCalls, countsBefore.modelCalls)
  assert.equal(countsAfter.toolCalls, countsBefore.toolCalls)
  const history = await browserHttp(ctxA, fixture.url + '/user/projects/' + String(seedA.projectId) + '/sessions')
  assert.equal(history.status(), 200)
  assert.ok(parseHistoryPage(await history.json()).sessions.some(row => row.sessionId === forkId))
  checks.coldRestartBytePreservation = true

  step = 'runtime grant revocation tears down USER project composition'
  await fixture.command('set-modules', { index: 0, grants: ['storage'] })
  await a.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  assert.equal(await a.getByText(/Preview fixture ready:/).count(), 0)
  assert.equal(await a.locator('iframe').count(), 0)
  await login(a, fixture.users[0]!.username, fixture.users[0]!.password)
  await ownProjects(a, String(seedA.projectId))
  await index(ctxA, fixture.url, 'user', false)
  assert.equal(await sessionRow(a, 'Conversa privada 0').getByRole('button', { name: 'Retomar', exact: true }).isDisabled(), true)
  await fixture.command('block-user', { index: 1 })
  await b.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  assert.equal(await b.getByText('Registro próprio 1', { exact: true }).count(), 0)
  await index(ctxB, fixture.url, 'public', false)
  checks.grantAndStatusTeardown = true
  assert.equal(traffic.get(a)?.errors, 0)
  assert.equal(traffic.get(b)?.errors, 0)
  assert.equal(traffic.get(master)?.errors, 0)
  checks.realModelCalls = consumed.modelCalls
  checks.realToolCalls = consumed.toolCalls
  await clientCoverage.finish(output)
  coverageFinished = true
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify({
    status: 'PASS', checks, phase: 'native-project-browser', auth: 'real-http-cookie',
    worker: 'real-loader-broker', externalReplay: 'assertConsumed',
    fixtureResolutionOnly: true, physicalUidMountNetworkProof: false,
  }, null, 2) + '\n')
} catch (error) {
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify({
    status: 'FAIL', step, errorClass: error instanceof Error ? error.name : 'unknown', checks,
    sites: error instanceof Error ? error.stack?.split('\n').filter(line => line.includes('native-project-browser-gate.host.ts'))
      .map(line => line.match(/:\d+:\d+/)?.[0]) : [],
  }, null, 2) + '\n')
  throw new Error('Native project browser gate failed at ' + step, { cause: error instanceof Error ? new Error(error.name) : undefined })
} finally {
  if (!coverageFinished) {
    try { await clientCoverage.finish(output, 'partial') } catch (cause) {
      await writeFile(resolve(output, 'client-coverage-failure.json'), JSON.stringify({
        completeness: 'unavailable', errorClass: cause instanceof Error ? cause.name : 'UnknownError',
      }, null, 2) + '\n').catch(() => { process.stderr.write('Partial V8 failure receipt unavailable\n') })
    }
  }
  for (const value of contexts) await value.close()
  await browser.close()
  await fixture.close()
}
