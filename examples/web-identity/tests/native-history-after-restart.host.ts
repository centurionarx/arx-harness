/**
 * Keyless scenario of the native browser fixture: an owned session's history opens again after the supervisor
 * restarts the project workers.
 *
 * One replayed turn, the fixture's code-built preview replay (no key, no recording), leaves the prompt's lease
 * retained as the session writer, as any browser prompt does. The restarted worker has a new worker id, so control
 * moves the writer only after it cancels that lease and receives the quiescent receipt (restarted-worker writer
 * handoff). Without the handoff, control refuses the new worker's hydration and Resume after the restart shows a
 * history load error instead of the history. The facts golden is the output of a run: `record` writes it, the
 * default mode compares against it.
 *
 * Run from the repository root after the build, through the pnpm `tsx` bin, which puts the hoisted workspace
 * packages on NODE_PATH for the in-process worker composition:
 *
 *     pnpm run test:auth:browser:history [record]
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserContext, Page } from 'playwright'
import { AUTH_HEADER, CSRF_HEADER, parseAuthState } from '@arx-ai/arx-web-identity/contract'
import { RpcId, clientRequestSchema, serverResponseSchema } from '@arx-ai/arx-host-apiproxy/api'
import { browserFixture } from './browser-fixture.host.ts'
import { browserHttp } from './browser-http.host.ts'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright') as typeof import('playwright')
const mode = process.argv[2]
if (mode !== undefined && mode !== 'record') throw new Error('usage: native-history-after-restart.host.ts [record]')
const GOLDEN = fileURLToPath(new URL('./snapshots/native-history-after-restart.expected.md', import.meta.url))

const fixture = await browserFixture('user', false, true, true)
const browser = await chromium.launch()
const ctx = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1280, height: 800 } })
let step = 'start'

async function rpc(context: BrowserContext, method: string, payload: unknown) {
  const response = await browserHttp(context, fixture.url + '/auth/session')
  assert.equal(response.status(), 200)
  const state = parseAuthState(await response.json())
  assert.ok(state.authenticated)
  const body = clientRequestSchema.parse({ type: 'client-request', rpcId: RpcId(randomUUID()), method, payload })
  return browserHttp(context, fixture.url + '/api/' + method, { method: 'POST',
    headers: { [AUTH_HEADER]: '1', [CSRF_HEADER]: state.csrfToken }, data: body })
}
async function openProject(page: Page, projectId: string): Promise<void> {
  const select = page.getByRole('combobox', { name: 'Meus projetos' })
  const toggle = page.getByRole('button', { name: 'Meus projetos', exact: true })
  await select.or(toggle).first().waitFor()
  if (await select.count() === 0) await toggle.click()
  await select.selectOption(projectId)
}
async function resume(page: Page, title: string): Promise<void> {
  await page.locator('li').filter({ has: page.getByText(title, { exact: true }) })
    .getByRole('button', { name: 'Retomar', exact: true }).click()
}

try {
  const page = await ctx.newPage()
  await page.goto(fixture.url)
  await page.getByRole('heading', { name: 'Entrar', exact: true }).waitFor()

  step = 'seed, sign in and resume'
  const seed = await fixture.command('seed-history', { index: 0 })
  const projectId = String(seed.projectId), workspaceId = String(seed.workspaceId), sessionId = String(seed.sessionId)
  await page.getByLabel('Nome de usuário ou e-mail').fill(fixture.users[0]!.username)
  await page.getByLabel('Senha', { exact: true }).fill(fixture.users[0]!.password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await openProject(page, projectId)
  await resume(page, 'Conversa privada 0')
  await page.getByText(/Resposta privada 0/).waitFor()

  step = 'one replayed turn whose prompt lease stays the session writer'
  const replay = await fixture.command('configure-preview-replay', { workspaceId, sessionId })
  assert.equal(replay.configured, true)
  const selected = await rpc(ctx, 'session.selectModel', { sessionId, provider: replay.provider, model: replay.model })
  assert.equal(selected.status(), 200)
  assert.ok(serverResponseSchema.parse(await selected.json()).result.ok)
  const composer = page.locator('textarea:visible')
  assert.equal(await composer.count(), 1)
  await composer.fill('Create the owned preview fixture.')
  await composer.press('Enter')
  await page.getByText(/Preview fixture ready:/).waitFor()
  const consumed = await fixture.command('finish-preview-replay', { workspaceId, sessionId })
  assert.equal(consumed.consumed, true)
  const before = await fixture.command('worker-counts')

  step = 'restart the workers and resume again'
  await fixture.command('restart-workers')
  await page.reload()
  await openProject(page, projectId)
  await resume(page, 'Conversa privada 0')
  // After the turn the breadcrumb also names the session after its first message, so the message is the last match.
  await page.getByText('Registro próprio 0', { exact: true }).last().waitFor()
  await page.getByText(/Resposta privada 0/).waitFor()
  await page.getByText(/Preview fixture ready:/).waitFor()
  const after = await fixture.command('worker-counts')

  const facts = [
    '# Owned history after a worker restart (native fixture)',
    '',
    '- Replayed turn: model calls ' + String(consumed.modelCalls) + ', tool calls ' + String(consumed.toolCalls),
    '- History load error after the restart: ' + String(await page.getByText(/Falha ao carregar o histórico/).count() > 0),
    '- Seeded reply visible after the restart: ' + String(await page.getByText(/Resposta privada 0/).count() === 1),
    '- Replayed turn reply visible after the restart: ' + String(await page.getByText(/Preview fixture ready:/).count() >= 1),
    '- Model calls before / after the restart: ' + String(before.modelCalls) + ' / ' + String(after.modelCalls),
    '- Tool calls before / after the restart: ' + String(before.toolCalls) + ' / ' + String(after.toolCalls),
  ].join('\n') + '\n'
  step = 'golden'
  if (mode === 'record') {
    await mkdir(dirname(GOLDEN), { recursive: true })
    await writeFile(GOLDEN, facts)
  } else {
    if (!existsSync(GOLDEN)) throw new Error('missing golden: run this scenario with `record` on dev-01 first')
    assert.equal(facts, await readFile(GOLDEN, 'utf8'))
  }
  process.stdout.write(JSON.stringify({ status: 'PASS', mode: mode ?? 'compare' }) + '\n')
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 'FAIL', step, errorClass: error instanceof Error ? error.name : 'unknown',
    sites: error instanceof Error ? error.stack?.split('\n').filter(line => line.includes('native-history-after-restart.host.ts'))
      .map(line => line.match(/:\d+:\d+/)?.[0]) : [] }) + '\n')
  process.exitCode = 1
} finally {
  await ctx.close()
  await browser.close()
  await fixture.close()
}
