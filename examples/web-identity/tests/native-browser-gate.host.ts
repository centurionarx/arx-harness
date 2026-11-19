/**
 * Real native HTML/browser gate over disposable identity and owned storage.
 * No trace, header/body logging, password receipt, or auth transport override.
 * Usage: native-browser-gate.host.ts <output> <evidence-root> <frontend-source-baseline>; output must lie inside evidence-root.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { createRequire } from 'node:module'
import { browserFixture } from './browser-fixture.host.ts'
import { ClientCoverageRecorder } from './browser-coverage.host.ts'
import { browserHttp } from './browser-http.host.ts'
import { parseAuthState, parseAdminUserList } from '@arx-ai/arx-web-identity/contract'
import type { Page, BrowserContext, Browser } from 'playwright'

const require = createRequire(resolve('apps/web/package.json'))
const { chromium } = require('playwright') as typeof import('playwright')
const [outputArg, evidenceRoot, sourceBaseline] = process.argv.slice(2)
if (!outputArg || !evidenceRoot || !sourceBaseline) throw new Error('usage: native-browser-gate.host.ts <output> <evidence-root> <frontend-source-baseline>')
const output = resolve(outputArg)
assert.ok(!relative(resolve(evidenceRoot), output).startsWith('..'), 'browser receipt must remain in isolated evidence')
await mkdir(output, { recursive: true })
let step = 'start real services'
const checks: Record<string, boolean | number | string[]> = {}
const fixture = await browserFixture('user', false, true)
const browser = await chromium.launch()
const contexts: BrowserContext[] = []
let storageDeniedBrowser: Browser | undefined
const clientCoverage = new ClientCoverageRecorder(evidenceRoot, sourceBaseline)
let coverageFinished = false
const requests = new WeakMap<Page, Array<{ method: string; path: string }>>()
const errors = new WeakMap<Page, string[]>()
function watch(page: Page): void {
  const seen: Array<{ method: string; path: string }> = [], failed: string[] = []
  requests.set(page, seen); errors.set(page, failed)
  page.on('request', (request) => { seen.push({ method: request.method(), path: new URL(request.url()).pathname }) })
  page.on('pageerror', () => { failed.push('pageerror') })
}
async function context() {
  const value = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 800 } })
  contexts.push(value); return value
}
async function page(ctx: BrowserContext, url: string) {
  const value = await ctx.newPage(); watch(value); await clientCoverage.start(value)
  await observeModuleCreates(value)
  await value.goto(url); return value
}
async function login(value: Page, identifier: string, password: string): Promise<void> {
  await value.getByLabel('Nome de usuário ou e-mail').fill(identifier)
  await value.getByLabel('Senha', { exact: true }).fill(password)
  await value.getByRole('button', { name: 'Entrar', exact: true }).click()
}
// The template's delivery origin is a reserved fixture domain. Only its
// pathname/fragment is rebased to the dynamically bound same-audience server.
// Auth, cookies, CSRF, token validation, and every browser request stay real.
function ephemeralRecoveryLink(value: unknown, audience: 'user' | 'admin' = 'user'): string {
  assert.equal(typeof value, 'string')
  const delivered = new URL(String(value))
  assert.equal(delivered.origin, 'https://' + audience + '.fixture.test')
  const origin = audience === 'user' ? fixture.url : fixture.adminUrl
  assert.ok(origin)
  return origin + delivered.pathname + delivered.hash
}
// Count calls only by delegating the actual HTML-installed facade, with its receiver intact.
async function observeModuleCreates(value: Page): Promise<void> {
  await value.route('**/plugins/@arx-ai/arx-client-modules/client.js*', async (route) => {
    await value.evaluate(`(() => {
      const target = Reflect.get(globalThis, '__ModuleLoader__')
      if (typeof target !== 'object' || target === null) throw new Error('real module facade missing')
      const create = Reflect.get(target, 'create')
      if (typeof create !== 'function') throw new Error('real module create missing')
      let count = 0
      Object.defineProperty(globalThis, '__ARX_FIXTURE_MODULE_CREATES__', { configurable: true, get: () => count })
      const installed = Reflect.set(target, 'create', function (...args) {
        count += 1
        return Reflect.apply(create, this, args)
      })
      if (!installed) throw new Error('real module facade is immutable')
    })()`)
    await route.continue()
  })
}
function bundleRequests(value: Page): number {
  return (requests.get(value) ?? []).filter(row => row.path.endsWith('.js')).length
}
async function moduleCreates(value: Page): Promise<unknown> {
  return await value.evaluate((): unknown => Reflect.get(globalThis, '__ARX_FIXTURE_MODULE_CREATES__'))
}
async function sameDocumentRecovery(value: Page, link: string, exerciseHistory = false): Promise<void> {
  const timeOrigin = await value.evaluate(() => performance.timeOrigin)
  const bundles = bundleRequests(value)
  assert.equal(await moduleCreates(value), 1)
  const transfer = await observeRecoveryTransfer(value)
  await value.goto(link)
  await value.getByRole('heading', { name: 'Definir nova senha', exact: true }).waitFor()
  assert.equal(await value.evaluate(() => performance.timeOrigin), timeOrigin)
  assert.equal(bundleRequests(value), bundles)
  assert.equal(await moduleCreates(value), 1)
  assert.equal(new URL(value.url()).hash, '')
  assert.equal(transfer.firstBundleSealed, false)
  assert.equal(transfer.beforeAuthGetConsumed, true)
  if (!exerciseHistory) return

  // These downstream taps retain only booleans/counts; suppressed HashChangeEvents never reach them.
  await value.evaluate(() => {
    const restored: boolean[] = []
    const probe = { hashChanges: 0, restored, unknownPopstate: 0, unknownHashChanges: 0 }
    Reflect.set(globalThis, '__ARX_FIXTURE_RECOVERY_TAPS__', probe)
    addEventListener('hashchange', () => {
      probe.hashChanges += 1
      if (location.hash !== '' && !/^(#reset=|#invite=)/.test(location.hash)) probe.unknownHashChanges += 1
    }, { capture: true })
    addEventListener('popstate', () => {
      const recognized = /^(#reset=|#invite=)/.test(location.hash)
      restored.push(recognized)
      if (location.hash !== '' && !recognized) probe.unknownPopstate += 1
    }, { capture: true })
  })
  await value.getByLabel('Nova senha', { exact: true }).fill('discarded-fixture-draft')
  await Promise.all([
    value.waitForResponse(response => new URL(response.url()).pathname === '/auth/session'
      && response.request().method() === 'GET' && response.status() === 200),
    value.evaluate((href) => {
      location.hash = new URL(href).hash
      location.hash = '#discarded-recovery'
    }, link),
  ])
  await value.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  assert.equal(await value.getByLabel('Nova senha', { exact: true }).count(), 0)
  assert.equal(new URL(value.url()).hash, '')
  // Both hash setters can synchronously scrub their entries. Prepare a latent
  // recovery entry without publishing, then exercise its real Back restoration.
  await value.evaluate((href) => {
    globalThis.history.pushState(null, '', href)
    globalThis.history.pushState(null, '', location.pathname + location.search)
  }, link)
  await Promise.all([
    value.waitForResponse(response => new URL(response.url()).pathname === '/auth/session'
      && response.request().method() === 'GET' && response.status() === 200),
    value.goBack(),
  ])
  await value.getByRole('heading', { name: 'Definir nova senha', exact: true }).waitFor()
  assert.equal(await value.getByLabel('Nova senha', { exact: true }).inputValue(), '')
  assert.equal(new URL(value.url()).hash, '')
  assert.equal(await value.evaluate(() => performance.timeOrigin), timeOrigin)
  assert.equal(bundleRequests(value), bundles)
  assert.equal(await moduleCreates(value), 1)
  // An empty recognized prefix still selects reset; it must retract the previous form and never submit itself.
  const recoveryPosts = () => (requests.get(value) ?? []).filter(row => row.method === 'POST'
    && (row.path === '/auth/password/reset' || row.path === '/auth/invitation/accept')).length
  const postsBeforeEmpty = recoveryPosts()
  await value.getByLabel('Nova senha', { exact: true }).fill('discarded-empty-prefix-draft')
  await value.getByLabel('Confirmar nova senha', { exact: true }).fill('discarded-empty-prefix-confirmation')
  await Promise.all([
    value.waitForResponse(response => new URL(response.url()).pathname === '/auth/session'
      && response.request().method() === 'GET' && response.status() === 200),
    value.evaluate(() => { location.hash = '#reset=' }),
  ])
  await value.getByRole('heading', { name: 'Definir nova senha', exact: true }).waitFor()
  assert.equal(await value.getByLabel('Nova senha', { exact: true }).inputValue(), '')
  assert.equal(await value.getByLabel('Confirmar nova senha', { exact: true }).inputValue(), '')
  assert.equal(new URL(value.url()).hash, '')
  assert.equal(recoveryPosts(), postsBeforeEmpty)
  assert.equal(await value.evaluate(() => performance.timeOrigin), timeOrigin)
  assert.equal(bundleRequests(value), bundles)
  assert.equal(await moduleCreates(value), 1)
  const tap = await value.evaluate(() => {
    const probe: unknown = Reflect.get(globalThis, '__ARX_FIXTURE_RECOVERY_TAPS__')
    if (typeof probe !== 'object' || probe === null || !('hashChanges' in probe) || !('restored' in probe)
      || !('unknownPopstate' in probe) || !('unknownHashChanges' in probe)
      || typeof probe.hashChanges !== 'number' || !Array.isArray(probe.restored)
      || typeof probe.unknownPopstate !== 'number' || typeof probe.unknownHashChanges !== 'number') {
      throw new Error('recovery observation missing')
    }
    const restored = probe.restored.map((value: unknown) => {
      if (typeof value !== 'boolean') throw new Error('recovery observation malformed')
      return value
    })
    return { hashChanges: probe.hashChanges, restored,
      unknownPopstate: probe.unknownPopstate, unknownHashChanges: probe.unknownHashChanges }
  })
  assert.equal(tap.hashChanges, 0)
  assert.ok(tap.restored.every(restored => !restored))
  assert.ok(tap.unknownPopstate > 0)
}
async function observeRecoveryTransfer(value: Page) {
  const observed = { firstBundleSealed: false, beforeAuthGetConsumed: false }
  await value.route('**/plugins/@arx-ai/arx-client-modules/client.js*', async (route) => {
    observed.firstBundleSealed = await value.evaluate(() => {
      const handle: unknown = (globalThis as { __ARX_RECOVERY_FRAGMENT__?: unknown }).__ARX_RECOVERY_FRAGMENT__
      return location.hash === '' && typeof handle === 'object' && handle !== null
        && Object.values(handle).every(field => typeof field === 'function')
    })
    await route.fallback()
  })
  await value.route('**/auth/session', async (route) => {
    observed.beforeAuthGetConsumed = await value.evaluate(() => location.hash === ''
      && (globalThis as { __ARX_RECOVERY_FRAGMENT__?: unknown }).__ARX_RECOVERY_FRAGMENT__ === undefined)
    await route.continue()
  })
  return observed
}
async function state(ctx: BrowserContext, origin = fixture.url) {
  const response = await browserHttp(ctx, origin + '/auth/session')
  assert.equal(response.status(), 200); return parseAuthState(await response.json())
}
function htmlGlobal(html: string, name: string): unknown {
  const prefix = '<script>globalThis[' + JSON.stringify(name) + '] = '
  const start = html.indexOf(prefix); assert.ok(start >= 0, 'native HTML marker missing')
  const end = html.indexOf('</script>', start)
  return JSON.parse(html.slice(start + prefix.length, end))
}
async function index(ctx: BrowserContext, url: string, kind: string): Promise<Record<string, unknown>> {
  const response = await browserHttp(ctx, url)
  assert.equal(response.status(), 200)
  assert.equal(response.headers()['cache-control'], 'no-store')
  assert.equal(response.headers()['referrer-policy'], 'no-referrer')
  const html = await response.text()
  assert.ok(!html.includes('__ARX_FORBIDDEN_GLOBAL_CONFIG__'))
  assert.ok(!html.includes('csrfToken')); assert.ok(!html.includes('must-not-ship'))
  const marker = htmlGlobal(html, '__ARX_CLIENT_COMPOSITION__') as Record<string, unknown>
  if (marker.kind !== kind) {
    const current = ctx.pages().find(value => new URL(value.url()).origin === new URL(url).origin)
    if (current !== undefined) {
      const live = await current.evaluate(async () => {
        const response = await fetch('/auth/session', { credentials: 'same-origin', cache: 'no-store' })
        const body: unknown = await response.json()
        return { status: response.status, authenticated: typeof body === 'object' && body !== null
          && 'authenticated' in body && body.authenticated === true }
      })
      checks.indexBrowserSessionAuthenticated = live.authenticated
      checks.indexBrowserSessionStatus = live.status
    }
    const apiState = await browserHttp(ctx, new URL(url).origin + '/auth/session')
    checks.indexAPISessionStatus = apiState.status()
    checks.indexAPISessionAuthenticated = parseAuthState(await apiState.json()).authenticated
    checks.indexJarCookieMetadata = (await ctx.cookies(url)).map(row => row.name + ':' + String(row.secure) + ':' + row.domain + ':' + row.path)
    checks.indexJarHasSecureAuthCookie = (await ctx.cookies(url)).some(row => row.name.startsWith('__Host-arx-') && row.secure)
    checks.indexMarkerKind = [String(marker.kind), kind]
  }
  assert.equal(marker.kind, kind)
  const graph = htmlGlobal(html, '__ARX_BOOT__') as { entries: Array<{ id: string }> }
  assert.equal(graph.entries.length, 6)
  assert.ok(!graph.entries.some(row => /connection|runtime|api-remotes|ui-workspace|ui-projects/.test(row.id)))
  return marker
}
try {
  step = 'public HTML and accessible login'
  const ctxA = await context(), ctxB = await context(), ctxAdmin = await context()
  const publicMarker = await index(ctxA, fixture.url, 'public')
  assert.equal(publicMarker.audience, 'user')
  const a = await page(ctxA, fixture.url)
  await a.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  assert.equal(await a.getByLabel('Nome de usuário ou e-mail').getAttribute('autocomplete'), 'username')
  assert.equal(await a.getByLabel('Senha', { exact: true }).getAttribute('autocomplete'), 'current-password')
  assert.equal(await a.getByRole('button', { name: /Cadastrar/ }).count(), 0)
  assert.ok(!(requests.get(a) ?? []).some(row => row.path.startsWith('/api/')))
  await a.screenshot({ path: resolve(output, 'login-desktop.png'), fullPage: true })
  await a.setViewportSize({ width: 375, height: 812 })
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await a.getByLabel('Nome de usuário ou e-mail').focus(); await a.keyboard.press('Tab')
  assert.equal(await a.getByLabel('Senha', { exact: true }).evaluate(element => element === document.activeElement), true)
  await a.screenshot({ path: resolve(output, 'login-mobile.png'), fullPage: true })
  for (const width of [360, 768, 1440]) {
    await a.setViewportSize({ width, height: 900 })
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await a.getByLabel('Nome de usuário ou e-mail').focus(); await a.keyboard.press('Tab')
    assert.equal(await a.getByLabel('Senha', { exact: true }).evaluate(element => element === document.activeElement), true)
    await a.keyboard.press('Shift+Tab')
    assert.equal(await a.getByLabel('Nome de usuário ou e-mail').evaluate(element => element === document.activeElement), true)
  }
  await a.setViewportSize({ width: 1280, height: 800 })
  checks.publicHtml = true; checks.accessibleResponsiveLogin = true
  checks.publicViewportWidths = ['360', '768', '1440']

  step = 'request marker mismatch rejects before factories'
  const poisoned = await context()
  await poisoned.route(fixture.url + '/', async (route) => {
    const response = await route.fetch()
    const html = await response.text()
    const prefix = '<script>globalThis["__ARX_CLIENT_COMPOSITION__"] = '
    const start = html.indexOf(prefix), end = html.indexOf('</script>', start)
    assert.ok(start >= 0)
    const body = html.slice(0, start + prefix.length) + JSON.stringify({ kind: 'user', audience: 'user', generation: 999 })
      + html.slice(end)
    await route.fulfill({ response, body })
  })
  const bad = await page(poisoned, fixture.url)
  await bad.getByRole('button', { name: 'Voltar ao acesso' }).waitFor()
  assert.equal(await bad.evaluate(() => (globalThis as { __ModuleLoader__?: { mode?: string } }).__ModuleLoader__?.mode), 'queue')
  assert.ok(!(requests.get(bad) ?? []).some(row => /runtime|connection|api-remotes/.test(row.path)))
  for (const poisonedPage of poisoned.pages()) await clientCoverage.stop(poisonedPage)
  await poisoned.close(); checks.markerMismatchClosed = true

  step = 'two own USER shells with real cookies and history'
  const seedA = await fixture.command('seed-history', { index: 0 })
  const seedB = await fixture.command('seed-history', { index: 1 })
  await login(a, fixture.users[0]!.username, fixture.users[0]!.password)
  await a.getByRole('heading', { name: 'Meus projetos', exact: true }).first().waitFor()
  const b = await page(ctxB, fixture.url)
  await login(b, fixture.users[1]!.username, fixture.users[1]!.password)
  await b.getByRole('heading', { name: 'Meus projetos', exact: true }).first().waitFor()
  const userMarker = await index(ctxA, fixture.url, 'user')
  const aState = await state(ctxA), bState = await state(ctxB)
  assert.ok(aState.authenticated && bState.authenticated)
  assert.notEqual(aState.principal.userId, bState.principal.userId)
  assert.equal(userMarker.generation, aState.generation)
  await a.getByRole('combobox', { name: 'Meus projetos' }).selectOption(String(seedA.projectId))
  await a.getByText('Conversa privada 0', { exact: true }).waitFor()
  await b.getByRole('combobox', { name: 'Meus projetos' }).selectOption(String(seedB.projectId))
  await b.getByText('Conversa privada 1', { exact: true }).waitFor()
  assert.equal(await b.getByRole('option', { name: 'Projeto privado 0' }).count(), 0)
  assert.equal(await b.getByText('Conversa privada 0', { exact: true }).count(), 0)
  assert.equal((await browserHttp(ctxB, fixture.url + '/user/sessions/' + String(seedA.sessionId) + '/history')).status(), 403)
  assert.equal((await browserHttp(ctxB, fixture.url + '/user/projects/' + String(seedA.projectId) + '/workspaces')).status(), 403)
  assert.ok([403, 404].includes((await browserHttp(ctxB, fixture.url + '/admin/users')).status()))
  assert.equal(await a.getByRole('button', { name: 'Retomar', exact: true }).isDisabled(), true)
  assert.equal(await a.getByRole('button', { name: 'Abrir workspace', exact: true }).isDisabled(), true)
  await a.getByRole('button', { name: 'Ver histórico', exact: true }).click()
  const history = a.getByRole('dialog', { name: 'Histórico salvo' })
  await history.waitFor()
  assert.ok((await history.locator('pre').textContent())?.includes('Registro próprio 0'))
  assert.ok(!(await history.locator('pre').textContent())?.includes('/volumes/'))
  assert.ok(!(await history.locator('pre').textContent())?.includes('"type":"session"'))
  await history.getByRole('button', { name: 'Fechar' }).click()
  const exportResponse = await browserHttp(ctxA, fixture.url + '/user/sessions/' + String(seedA.sessionId) + '/export')
  assert.equal(exportResponse.status(), 200)
  assert.ok((await exportResponse.body()).toString('utf8').includes('"type":"session"'))
  checks.twoUserOwnerDenial = true; checks.ownHistoryHeaderProjection = true; checks.rawOwnExportPreserved = true

  step = 'USER create virtual project/workspace and mutation refetch'
  await a.getByLabel('Nome do projeto').fill('Projeto criado no navegador')
  await a.getByRole('button', { name: 'Criar projeto', exact: true }).click()
  await a.getByRole('option', { name: 'Projeto criado no navegador' }).waitFor({ state: 'attached' })
  await a.getByLabel('Nome do workspace').fill('Workspace privado virtual')
  await a.getByRole('button', { name: 'Criar workspace', exact: true }).click()
  await a.getByText('Workspace privado virtual', { exact: true }).waitFor()
  assert.equal(await b.getByRole('option', { name: 'Projeto criado no navegador' }).count(), 0)
  await a.getByRole('button', { name: 'Remover agrupamento', exact: true }).click()
  await a.getByText('Nenhum workspace neste projeto.', { exact: true }).waitFor()
  await a.getByRole('combobox', { name: 'Meus projetos' }).selectOption(String(seedA.projectId))
  await a.getByText('Conversa privada 0', { exact: true }).waitFor()
  await a.getByRole('button', { name: 'Renomear conversa', exact: true }).click()
  await a.getByLabel('Renomear conversa').fill('Conversa renomeada própria')
  await a.getByRole('button', { name: 'Salvar', exact: true }).click()
  await a.getByText('Conversa renomeada própria', { exact: true }).waitFor()
  assert.equal(await b.getByText('Conversa renomeada própria', { exact: true }).count(), 0)
  checks.virtualProvisioningAndMutationRefetch = true

  step = 'MASTER same authority uses separate audience and administrative-only tree'
  assert.ok(fixture.adminUrl)
  const admin = await page(ctxAdmin, fixture.adminUrl)
  try { await login(admin, 'admin@centurionarx.com', fixture.masterPassword) } catch (error) {
    const state = parseAuthState(await (await browserHttp(ctxAdmin, fixture.adminUrl + '/auth/session')).json())
    const surface = await admin.evaluate(() => {
      const marker = (globalThis as { __ARX_CLIENT_COMPOSITION__?: { kind?: unknown; audience?: unknown } }).__ARX_CLIENT_COMPOSITION__
      return { markerKind: typeof marker?.kind === 'string' ? marker.kind : 'missing',
        markerAudience: typeof marker?.audience === 'string' ? marker.audience : 'missing',
        inputs: document.querySelectorAll('input').length, roots: document.querySelectorAll('[data-auth-composition]').length,
        mainElements: document.querySelectorAll('main').length }
    })
    await writeFile(resolve(output, 'admin-boot-diagnostic.json'), JSON.stringify({
      authenticated: state.authenticated, audience: state.audience, surface,
      pageErrorCount: errors.get(admin)?.length ?? 0, requestPaths: (requests.get(admin) ?? []).map(row => row.path),
    }, null, 2) + '\n')
    throw error
  }
  await admin.getByRole('heading', { name: 'MASTER-ADMIN', exact: true }).waitFor()
  const adminMarker = await index(ctxAdmin, fixture.adminUrl, 'admin')
  assert.equal(adminMarker.audience, 'admin')
  assert.equal(await admin.getByRole('heading', { name: 'Meus projetos', exact: true }).count(), 0)
  assert.ok([401, 403].includes((await browserHttp(ctxAdmin, fixture.url + '/user/projects')).status()))
  assert.ok(!(requests.get(admin) ?? []).some(row => row.path.startsWith('/api/') || row.path.startsWith('/user/')))
  await admin.getByLabel('Nome de usuário', { exact: true }).fill('fixture-browser-created')
  await admin.getByLabel('E-mail', { exact: true }).fill('fixture-browser-created@fixture.test')
  await admin.getByRole('button', { name: 'Criar usuário', exact: true }).click()
  const created = admin.locator('li').filter({ hasText: 'fixture-browser-created@fixture.test' })
  await created.getByText('Estado: Pendente', { exact: true }).waitFor()
  await Promise.all([
    admin.waitForResponse(response => new URL(response.url()).pathname.endsWith('/invitation')
      && response.request().method() === 'POST' && response.status() === 202),
    created.getByRole('button', { name: 'Enviar convite', exact: true }).click(),
  ])
  const invitation = await fixture.command('recovery-link', { purpose: 'invitation', to: 'fixture-browser-created@fixture.test' })
  const invitationContext = await context()
  const invited = await invitationContext.newPage(); watch(invited)
  const invitedTransfer = await observeRecoveryTransfer(invited)
  await invited.goto(ephemeralRecoveryLink(invitation.link))
  await invited.getByRole('heading', { name: 'Aceitar convite', exact: true }).waitFor()
  assert.equal(new URL(invited.url()).hash, '')
  assert.equal(await invited.evaluate((): unknown => { const value: unknown = globalThis.history.state; return value }), null)
  const invitedPassword = 'Fixture-' + crypto.randomUUID() + '-invitation'
  await invited.getByLabel('Nova senha', { exact: true }).fill(invitedPassword)
  await invited.getByLabel('Confirmar nova senha', { exact: true }).fill(invitedPassword)
  await invited.getByRole('button', { name: 'Aceitar convite', exact: true }).click()
  await invited.getByText('Senha definida. Volte ao acesso para entrar.', { exact: true }).waitFor()
  assert.equal((await state(invitationContext)).authenticated, false)
  assert.equal(invitedTransfer.firstBundleSealed, true)
  assert.equal(invitedTransfer.beforeAuthGetConsumed, true)
  const adminUsers = await browserHttp(ctxAdmin, fixture.adminUrl + '/admin/users')
  assert.equal(adminUsers.status(), 200)
  const pending = parseAdminUserList(await adminUsers.json()).users.find(user => user.username === 'fixture-browser-created')
  assert.equal(pending?.status, 'PENDING'); assert.equal(pending?.passwordEstablished, true)
  assert.equal((errors.get(invited) ?? []).length, 0)
  assert.ok(!(requests.get(invited) ?? []).some(row => row.path.startsWith('/api/')))
  for (const invitationPage of invitationContext.pages()) await clientCoverage.stop(invitationPage)
  await invitationContext.close()
  checks.invitationTransferBeforeBundleAndAuthGet = true
  checks.invitationNoAutoLoginOrApproval = true
  await created.getByRole('button', { name: 'Liberar acesso', exact: true }).click()
  await created.getByText('Estado: Ativo', { exact: true }).waitFor()
  await admin.screenshot({ path: resolve(output, 'master-admin.png'), fullPage: true })
  checks.sameAuthorityMasterAudience = true; checks.masterAdminOnly = true

  step = 'active USER invitation stays public and returns to the same real principal'
  await admin.getByLabel('Nome de usuário', { exact: true }).fill('fixture-active-invite')
  await admin.getByLabel('E-mail', { exact: true }).fill('fixture-active-invite@fixture.test')
  await admin.getByRole('button', { name: 'Criar usuário', exact: true }).click()
  const activeTarget = admin.locator('li').filter({ hasText: 'fixture-active-invite@fixture.test' })
  await activeTarget.getByText('Estado: Pendente', { exact: true }).waitFor()
  await Promise.all([
    admin.waitForResponse(response => new URL(response.url()).pathname.endsWith('/invitation')
      && response.request().method() === 'POST' && response.status() === 202),
    activeTarget.getByRole('button', { name: 'Enviar convite', exact: true }).click(),
  ])
  const activeInvitation = await fixture.command('recovery-link', { purpose: 'invitation', to: 'fixture-active-invite@fixture.test' })
  await index(ctxA, fixture.url + '/invite', 'public')
  const activeInvite = await ctxA.newPage(); watch(activeInvite)
  const activeInviteTransfer = await observeRecoveryTransfer(activeInvite)
  await activeInvite.goto(ephemeralRecoveryLink(activeInvitation.link))
  await activeInvite.getByRole('heading', { name: 'Aceitar convite', exact: true }).waitFor()
  const activeInvitePassword = 'Fixture-' + crypto.randomUUID() + '-active-invitation'
  await activeInvite.getByLabel('Nova senha', { exact: true }).fill(activeInvitePassword)
  await activeInvite.getByLabel('Confirmar nova senha', { exact: true }).fill(activeInvitePassword)
  await activeInvite.getByRole('button', { name: 'Aceitar convite', exact: true }).click()
  await activeInvite.getByText('Senha definida. Volte ao acesso para entrar.', { exact: true }).waitFor()
  const stillA = await state(ctxA)
  assert.ok(stillA.authenticated)
  assert.equal(stillA.principal.userId, aState.principal.userId)
  assert.equal(activeInviteTransfer.firstBundleSealed, true)
  assert.equal(activeInviteTransfer.beforeAuthGetConsumed, true)
  await activeInvite.getByRole('button', { name: 'Voltar ao acesso', exact: true }).click()
  await activeInvite.getByRole('heading', { name: 'Meus projetos', exact: true }).first().waitFor()
  assert.equal(new URL(activeInvite.url()).pathname, '/')
  await clientCoverage.stop(activeInvite)
  await activeInvite.close()
  await a.getByRole('heading', { name: 'Meus projetos', exact: true }).first().waitFor()
  checks.activeUserInvitationSamePrincipalAndCanonicalExit = true

  step = 'active MASTER invitation presentation and canonical exit'
  await index(ctxAdmin, fixture.adminUrl + '/invite', 'public')
  const masterInviteTransfer = await observeRecoveryTransfer(admin)
  await admin.goto(fixture.adminUrl + '/invite#invite=invalid-fixture-display-only')
  await admin.getByRole('heading', { name: 'Aceitar convite', exact: true }).waitFor()
  assert.equal(masterInviteTransfer.firstBundleSealed, true)
  assert.equal(masterInviteTransfer.beforeAuthGetConsumed, true)
  const stillMaster = await state(ctxAdmin, fixture.adminUrl)
  assert.ok(stillMaster.authenticated)
  assert.equal(stillMaster.principal.role, 'MASTER_ADMIN')
  await admin.getByRole('button', { name: 'Voltar ao acesso', exact: true }).click()
  await admin.getByRole('heading', { name: 'MASTER-ADMIN', exact: true }).waitFor()
  assert.equal(new URL(admin.url()).pathname, '/')
  checks.activeMasterInvitationPublicAndCanonicalExit = true

  step = 'logout clears both tabs and back navigation'
  await a.getByRole('button', { name: 'Minha conta', exact: true }).click()
  await a.getByText(fixture.users[0]!.username, { exact: true }).waitFor()
  const secondTab = await page(ctxA, fixture.url)
  await secondTab.getByRole('heading', { name: 'Meus projetos', exact: true }).first().waitFor()
  await a.evaluate(() => {
    localStorage.setItem('arx.private.probe', 'stale')
    sessionStorage.setItem('arx.private.probe', 'stale')
    globalThis.history.replaceState({ selectedSession: 'stale' }, '', location.pathname)
  })
  await a.getByRole('button', { name: 'Sair', exact: true }).first().click()
  await a.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  await secondTab.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  assert.equal(await a.evaluate(() => localStorage.getItem('arx.private.probe')), null)
  assert.equal(await a.evaluate(() => sessionStorage.getItem('arx.private.probe')), null)
  assert.equal(await a.evaluate((): unknown => { const value: unknown = globalThis.history.state; return value }), null)
  assert.equal(await a.getByText('Conversa renomeada própria', { exact: true }).count(), 0)
  await a.goto(fixture.url + '/reset'); await a.goBack()
  await a.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  checks.logoutMultiTabAndBack = true

  step = 'MASTER blocks the live other USER through the real admin UI'
  const target = admin.locator('li').filter({ hasText: fixture.users[1]!.username })
  await target.getByRole('button', { name: 'Bloquear acesso', exact: true }).click()
  await target.getByText('Estado: Bloqueado', { exact: true }).waitFor()
  await b.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  assert.equal((await state(ctxB)).authenticated, false)
  await index(ctxB, fixture.url, 'public')
  assert.equal(await b.getByText('Conversa privada 1', { exact: true }).count(), 0)
  checks.masterRevocationEndsUserTree = true

  step = 'fresh real recovery consumes a fragment once without auto-login'
  await a.getByRole('button', { name: 'Esqueci minha senha', exact: true }).click()
  await a.getByLabel('Nome de usuário ou e-mail').fill(fixture.users[0]!.username)
  await Promise.all([
    a.waitForResponse(response => new URL(response.url()).pathname === '/auth/password/forgot'
      && response.request().method() === 'POST' && response.status() === 202),
    a.getByRole('button', { name: 'Recuperar acesso', exact: true }).click(),
  ])
  await a.getByText('Se houver uma conta elegível, você receberá as instruções de recuperação.', { exact: true }).waitFor()
  const recovery = await fixture.command('recovery-link', { purpose: 'reset', to: aState.principal.email })
  const recoveredTransfer = await observeRecoveryTransfer(a)
  await a.goto(ephemeralRecoveryLink(recovery.link))
  await a.getByRole('heading', { name: 'Definir nova senha', exact: true }).waitFor()
  assert.equal(new URL(a.url()).hash, '')
  assert.equal(await a.evaluate((): unknown => { const value: unknown = globalThis.history.state; return value }), null)
  const nextPassword = 'Fixture-' + crypto.randomUUID() + '-recovery'
  await a.getByLabel('Nova senha', { exact: true }).fill(nextPassword)
  await a.getByLabel('Confirmar nova senha', { exact: true }).fill(nextPassword)
  await a.getByRole('button', { name: 'Definir nova senha', exact: true }).click()
  await a.getByText('Senha definida. Volte ao acesso para entrar.', { exact: true }).waitFor()
  assert.equal((await state(ctxA)).authenticated, false)
  assert.equal(recoveredTransfer.firstBundleSealed, true); assert.equal(recoveredTransfer.beforeAuthGetConsumed, true)
  checks.recoveryFragmentBeforeAnyBundle = true; checks.recoveryTransferTakenBeforeAuthGet = true
  checks.recoveryFragmentNoAutoLogin = true

  step = 'login after reset leaves recovery pathname and performs a fresh USER boot'
  await a.getByRole('button', { name: 'Voltar ao acesso', exact: true }).click()
  await a.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  assert.equal(new URL(a.url()).pathname, '/')
  await login(a, fixture.users[0]!.username, nextPassword)
  await a.getByRole('heading', { name: 'Meus projetos', exact: true }).first().waitFor()
  assert.equal(new URL(a.url()).pathname, '/')
  await index(ctxA, fixture.url, 'user')
  await clientCoverage.stop(secondTab)
  await secondTab.close()
  checks.loginAfterResetFreshCanonicalUserBoot = true

  step = 'active USER reset uses the public graph and revokes the old real session'
  const activeBeforeReset = await state(ctxA)
  assert.ok(activeBeforeReset.authenticated)
  const activeResetMarker = await index(ctxA, fixture.url + '/reset', 'public')
  assert.equal(activeResetMarker.generation, activeBeforeReset.generation)
  await a.goto(fixture.url + '/reset')
  await a.getByRole('button', { name: 'Esqueci minha senha', exact: true }).click()
  await a.getByLabel('Nome de usuário ou e-mail').fill(fixture.users[0]!.username)
  await a.getByRole('button', { name: 'Recuperar acesso', exact: true }).click()
  await a.getByText('Se houver uma conta elegível, você receberá as instruções de recuperação.', { exact: true }).waitFor()
  const activeRecovery = await fixture.command('recovery-link', { purpose: 'reset', to: aState.principal.email })
  const activeResetLink = ephemeralRecoveryLink(activeRecovery.link)
  await sameDocumentRecovery(a, activeResetLink, true)
  checks.activeUserSameDocumentRecovery = true
  checks.recoveryTwoHashesAndBackStripBeforeDownstreamTaps = true
  await a.goto(fixture.url + '/invite')
  await a.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  const activeResetTransfer = await observeRecoveryTransfer(a)
  await a.goto(activeResetLink)
  await a.getByRole('heading', { name: 'Definir nova senha', exact: true }).waitFor()
  assert.equal(activeResetTransfer.firstBundleSealed, true)
  assert.equal(activeResetTransfer.beforeAuthGetConsumed, true)
  const activeResetPassword = 'Fixture-' + crypto.randomUUID() + '-active-reset'
  await a.getByLabel('Nova senha', { exact: true }).fill(activeResetPassword)
  await a.getByLabel('Confirmar nova senha', { exact: true }).fill(activeResetPassword)
  const activeResetTimeOrigin = await a.evaluate(() => performance.timeOrigin)
  await Promise.all([
    a.waitForResponse(response => new URL(response.url()).pathname === '/auth/password/reset'
      && response.request().method() === 'POST' && response.status() === 200),
    a.getByRole('button', { name: 'Definir nova senha', exact: true }).click(),
  ])
  // The active session is revoked; its real boundary opens a fresh public document.
  await a.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  assert.notEqual(await a.evaluate(() => performance.timeOrigin), activeResetTimeOrigin)
  assert.equal(new URL(a.url()).pathname, '/reset')
  assert.equal(await moduleCreates(a), 1)
  const activePublicMarker = await index(ctxA, fixture.url + '/reset', 'public')
  assert.equal(activePublicMarker.audience, 'user'); assert.equal(activePublicMarker.generation, undefined)
  assert.equal((await state(ctxA)).authenticated, false)
  await login(a, fixture.users[0]!.username, activeResetPassword)
  await a.getByRole('heading', { name: 'Meus projetos', exact: true }).first().waitFor()
  assert.equal(new URL(a.url()).pathname, '/')
  checks.activeUserResetPublicRevocationAndLogin = true

  step = 'active MASTER reset preserves audience, revokes cookie, and returns through canonical login'
  const masterBeforeReset = await state(ctxAdmin, fixture.adminUrl)
  assert.ok(masterBeforeReset.authenticated)
  const masterResetMarker = await index(ctxAdmin, fixture.adminUrl + '/reset', 'public')
  assert.equal(masterResetMarker.generation, masterBeforeReset.generation)
  await admin.goto(fixture.adminUrl + '/reset')
  await admin.getByRole('button', { name: 'Esqueci minha senha', exact: true }).click()
  await admin.getByLabel('Nome de usuário ou e-mail').fill('admin@centurionarx.com')
  await admin.getByRole('button', { name: 'Recuperar acesso', exact: true }).click()
  await admin.getByText('Se houver uma conta elegível, você receberá as instruções de recuperação.', { exact: true }).waitFor()
  const masterRecovery = await fixture.command('recovery-link', { purpose: 'reset', to: 'admin@centurionarx.com' })
  const masterResetLink = ephemeralRecoveryLink(masterRecovery.link, 'admin')
  await sameDocumentRecovery(admin, masterResetLink)
  checks.activeMasterSameDocumentRecovery = true
  await admin.goto(fixture.adminUrl + '/invite')
  await admin.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  const masterResetTransfer = await observeRecoveryTransfer(admin)
  await admin.goto(masterResetLink)
  await admin.getByRole('heading', { name: 'Definir nova senha', exact: true }).waitFor()
  assert.equal(masterResetTransfer.firstBundleSealed, true)
  assert.equal(masterResetTransfer.beforeAuthGetConsumed, true)
  const masterResetPassword = 'Fixture-' + crypto.randomUUID() + '-master-reset'
  await admin.getByLabel('Nova senha', { exact: true }).fill(masterResetPassword)
  await admin.getByLabel('Confirmar nova senha', { exact: true }).fill(masterResetPassword)
  const masterResetTimeOrigin = await admin.evaluate(() => performance.timeOrigin)
  await Promise.all([
    admin.waitForResponse(response => new URL(response.url()).pathname === '/auth/password/reset'
      && response.request().method() === 'POST' && response.status() === 200),
    admin.getByRole('button', { name: 'Definir nova senha', exact: true }).click(),
  ])
  // The admin audience follows its own real revocation into a fresh public document.
  await admin.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  assert.notEqual(await admin.evaluate(() => performance.timeOrigin), masterResetTimeOrigin)
  assert.equal(new URL(admin.url()).pathname, '/reset')
  assert.equal(await moduleCreates(admin), 1)
  const masterPublicMarker = await index(ctxAdmin, fixture.adminUrl + '/reset', 'public')
  assert.equal(masterPublicMarker.audience, 'admin'); assert.equal(masterPublicMarker.generation, undefined)
  assert.equal((await state(ctxAdmin, fixture.adminUrl)).authenticated, false)
  await login(admin, 'arxadmin', masterResetPassword)
  await admin.getByRole('heading', { name: 'MASTER-ADMIN', exact: true }).waitFor()
  assert.equal(new URL(admin.url()).pathname, '/')
  checks.activeMasterResetPublicRevocationAndLogin = true

  step = 'real offline logout retains a negative guard across F5, Back and two tabs'
  const offlineBefore = await state(ctxA)
  assert.ok(offlineBefore.authenticated)
  const offlinePeer = await page(ctxA, fixture.url)
  await offlinePeer.getByRole('heading', { name: 'Meus projetos', exact: true }).first().waitFor()
  let persistedRestores = 0
  await a.exposeBinding('recordAuthPageShow', (_, persisted: unknown) => { if (persisted === true) persistedRestores += 1 })
  await a.addInitScript("window.addEventListener('pageshow', event => void globalThis.recordAuthPageShow(event.persisted))")
  await a.evaluate(() => {
    localStorage.setItem('arx.private.offline-probe', 'stale')
    sessionStorage.setItem('arx.private.offline-probe', 'stale')
    globalThis.history.replaceState({ selectedSession: 'stale' }, '', location.pathname)
  })
  // The actual browser goes offline only after the peer has received the real begin message.
  // No auth response is fulfilled, replaced or mocked by this coordination route.
  await a.route('**/auth/logout', async (route) => {
    await offlinePeer.locator('[data-arx-auth-boundary="logout-pending"]').waitFor()
    await ctxA.setOffline(true)
    await route.continue()
  })
  await a.getByRole('button', { name: 'Sair', exact: true }).first().click()
  await a.waitForFunction((expected) => {
    const notice = document.querySelector('[data-arx-auth-boundary="logout"]')
    if (notice === null) return false
    const first = notice.firstChild
    const rect = notice.getBoundingClientRect()
    return first?.nodeType === Node.TEXT_NODE && first.textContent === expected
      && getComputedStyle(notice).visibility === 'visible' && rect.width > 0 && rect.height > 0
  }, 'Não foi possível confirmar a saída. O acesso permanece fechado.')
  assert.equal(await a.locator('[data-arx-auth-boundary="logout"]').evaluate(notice =>
    notice.firstChild?.nodeType === Node.TEXT_NODE ? notice.firstChild.textContent : null),
  'Não foi possível confirmar a saída. O acesso permanece fechado.')
  assert.equal(await a.locator('[data-arx-auth-boundary="logout"]').isVisible(), true)
  assert.equal(await a.getByRole('heading', { name: 'Meus projetos', exact: true }).count(), 0)
  assert.equal(await offlinePeer.getByRole('heading', { name: 'Meus projetos', exact: true }).count(), 0)
  assert.equal(await a.evaluate(() => localStorage.getItem('arx.private.offline-probe')), null)
  assert.equal(await a.evaluate(() => sessionStorage.getItem('arx.private.offline-probe')), null)
  assert.equal(await a.evaluate((): unknown => globalThis.history.state), null)
  await ctxA.setOffline(false)
  await a.unroute('**/auth/logout')
  const failedLogoutSession = await state(ctxA)
  assert.ok(failedLogoutSession.authenticated)
  assert.equal(failedLogoutSession.generation, offlineBefore.generation)
  await a.reload()
  await a.locator('[data-arx-auth-boundary="logout-blocked"]').waitFor()
  await offlinePeer.reload()
  await offlinePeer.locator('[data-arx-auth-boundary="logout-blocked"]').waitFor()
  for (const value of [a, offlinePeer]) {
    assert.equal(await value.getByRole('heading', { name: 'Meus projetos', exact: true }).count(), 0)
    assert.equal(await value.getByText(fixture.users[0]!.username, { exact: true }).count(), 0)
  }
  await a.goto(fixture.url + '/reset')
  await a.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  await a.goBack()
  await a.locator('[data-arx-auth-boundary="logout-blocked"]').waitFor()
  // A real delayed neutral ACK cannot affect a disposed handle or the fresh kernel's guard.
  await a.evaluate(() => {
    const raw = localStorage.getItem('arx.web.logout-denial')
    if (raw === null) throw new Error('negative guard absent after failed logout')
    const guard: unknown = JSON.parse(raw)
    if (typeof guard !== 'object' || guard === null || !('operationId' in guard) || typeof guard.operationId !== 'string') {
      throw new Error('negative guard metadata invalid')
    }
    const channel = new BroadcastChannel('arx.web.identity')
    channel.postMessage({ type: 'logout-ack', operationId: guard.operationId }); channel.close()
  })
  assert.equal(await a.getByRole('heading', { name: 'Meus projetos', exact: true }).count(), 0)
  assert.equal(await a.evaluate(() => localStorage.getItem('arx.web.logout-denial') !== null), true)
  checks.offlineLogoutF5BackTwoTabsStayClosed = true
  checks.actualPersistedPageRestores = persistedRestores
  await a.getByRole('button', { name: 'Entrar novamente', exact: true }).click()
  await a.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  assert.equal(new URL(a.url()).pathname, '/reset')
  await login(a, fixture.users[0]!.username, activeResetPassword)
  await a.getByRole('heading', { name: 'Meus projetos', exact: true }).first().waitFor()
  const explicitReentry = await state(ctxA)
  assert.ok(explicitReentry.authenticated)
  assert.equal(explicitReentry.generation, offlineBefore.generation)
  assert.equal(await a.evaluate(() => localStorage.getItem('arx.web.logout-denial')), null)
  await offlinePeer.reload()
  await offlinePeer.getByRole('heading', { name: 'Meus projetos', exact: true }).first().waitFor()
  await a.getByRole('button', { name: 'Sair', exact: true }).first().click()
  await a.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  await offlinePeer.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  await clientCoverage.stop(offlinePeer); await offlinePeer.close()
  checks.explicitConfirmedLoginReentersSameGeneration = true
  checks.offlineThenConfirmedLogoutBothTabs = true

  step = 'real Chromium with local storage disabled cannot admit private factories'
  storageDeniedBrowser = await chromium.launch({ args: ['--disable-local-storage'] })
  const deniedContext = await storageDeniedBrowser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 800 } })
  contexts.push(deniedContext)
  const deniedPage = await page(deniedContext, fixture.url)
  await deniedPage.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()
  const deniedLogin = await browserHttp(deniedContext, fixture.url + '/auth/login', { method: 'POST',
    headers: { 'X-Arx-Auth': '1' }, data: { identifier: fixture.users[0]!.username, password: activeResetPassword } })
  assert.equal(deniedLogin.status(), 200)
  assert.equal(parseAuthState(await deniedLogin.json()).authenticated, true)
  const beforeDeniedBoot = (requests.get(deniedPage) ?? []).length
  await deniedPage.reload()
  await deniedPage.locator('[data-arx-auth-boundary="logout-blocked"]').waitFor()
  await deniedPage.getByText(/O navegador não permitiu preservar o bloqueio após recarregar/).waitFor()
  assert.equal((await state(deniedContext)).authenticated, true)
  assert.equal(await deniedPage.getByRole('heading', { name: 'Meus projetos', exact: true }).count(), 0)
  assert.ok(!(requests.get(deniedPage) ?? []).slice(beforeDeniedBoot)
    .some(row => row.path.startsWith('/plugins/@arx-ai/arx-client-ui-auth/client.js')))
  assert.equal((errors.get(deniedPage) ?? []).length, 0)
  checks.realStorageUnavailablePrivateAdmissionClosed = true

  step = 'final independent contexts remain free of protected transport'
  for (const value of [a, b, admin]) {
    assert.ok(!(requests.get(value) ?? []).some(row => row.path.startsWith('/api/')))
    assert.equal((errors.get(value) ?? []).length, 0)
  }
  checks.applicationNoProjectTransport = true
  await clientCoverage.finish(output)
  coverageFinished = true
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify({
    status: 'PASS', phase: 'native-application-http', checks,
    actualCookies: true, actualRequestRenderer: true, actualLoaderAndBundles: true,
    projectRuntimeWorkerGate: 'pending', vmIsolationProof: false, traces: false,
    resolution: fixture.resolution, recoveryOrigin: 'fixture-ephemeral-rebased',
  }, null, 2) + '\n')
  process.stdout.write(JSON.stringify({ status: 'PASS', phase: 'native-application-http', checks }) + '\n')
} catch (cause) {
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify({
    status: 'FAIL', phase: 'native-application-http', step,
    errorClass: cause instanceof Error ? cause.name : 'UnknownError', checks,
    sites: cause instanceof Error ? cause.stack?.split('\n').filter(line => line.includes('native-browser-gate.host.ts'))
      .map(line => line.match(/:\d+:\d+/)?.[0]) : [],
    projectRuntimeWorkerGate: 'pending', traces: false,
  }, null, 2) + '\n')
  throw new Error('Native browser gate failed at stage: ' + step)
} finally {
  if (!coverageFinished) {
    try { await clientCoverage.finish(output, 'partial') } catch (cause) {
      await writeFile(resolve(output, 'client-coverage-failure.json'), JSON.stringify({
        completeness: 'unavailable', errorClass: cause instanceof Error ? cause.name : 'UnknownError',
      }, null, 2) + '\n').catch(() => { process.stderr.write('Partial V8 failure receipt unavailable\n') })
    }
  }
  await Promise.allSettled(contexts.map(value => value.close()))
  await storageDeniedBrowser?.close(); await browser.close(); await fixture.close()
}
