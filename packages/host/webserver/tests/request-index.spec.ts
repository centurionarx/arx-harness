/** Native request rendering has a distinct seat and never runs operator injections. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@arx-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import WebServer, { RequestIndexUnavailableError, renderIndexInjections } from '../src/index.ts'
import * as FrontendStatic from '../../frontend-static/src/index.ts'

const resources: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of resources.splice(0).reverse()) await close() })

async function serve(accessMode: 'local' | 'authenticated') {
  const root = await mkdtemp(join(tmpdir(), 'arx-index-seat-'))
  resources.push(() => rm(root, { recursive: true, force: true }))
  const distIndex = join(root, 'index.html')
  await writeFile(distIndex, '<html><head></head><body><main>fixture shell</main></body></html>')
  const ctx = new Context()
  resources.push(() => ctx.fiber.dispose())
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0, accessMode })
  await ctx.plugin(FrontendStatic, { distIndex })
  ctx.on('webserver/index-inject', (rows) => { rows.push({ kind: 'global', name: '__OPERATOR_ONLY__', value: 'operator-only-fixture' }) })
  ctx.webServer.tapIndex(html => html.replace('</body>', 'operator-tap-fixture</body>'))
  return { ctx, origin: 'http://127.0.0.1:' + String(ctx.webServer.port) }
}

describe('WebServer request index seat', () => {
  it('keeps the existing local listeners and taps when no native composition is selected', async () => {
    const fixture = await serve('local')
    expect(fixture.ctx.webServer.accessMode).toBe('local')
    const page = await fetch(fixture.origin)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('operator-only-fixture')
    expect(html).toContain('operator-tap-fixture')
    expect(() => fixture.ctx.webServer.registerRequestIndexRenderer(async html => html)).toThrow(/requires authenticated mode/)
    expect((await fetch(fixture.origin + '/reset')).status).toBe(404)
  })

  it('requires a single request renderer and preserves the original request without local taps', async () => {
    const fixture = await serve('authenticated')
    expect(fixture.ctx.webServer.accessMode).toBe('authenticated')
    const missing = await fetch(fixture.origin)
    expect(missing.status).toBe(503)
    expect(missing.headers.get('cache-control')).toBe('no-store')
    expect(() => fixture.ctx.webServer.collectIndexInjections()).toThrow(RequestIndexUnavailableError)
    expect(() => fixture.ctx.webServer.renderIndex('<html></html>')).toThrow(RequestIndexUnavailableError)
    const render = async (html: string, request: import('node:http').IncomingMessage) =>
      renderIndexInjections(html, [{ kind: 'global', name: '__REQUEST_TEST__', value: {
        host: request.headers.host, marker: request.headers['x-request-fixture'],
      } }])
    const release = fixture.ctx.webServer.registerRequestIndexRenderer(render)
    expect(() => fixture.ctx.webServer.registerRequestIndexRenderer(render)).toThrow(/already registered/)
    for (const path of ['/', '/index.html', '/reset', '/invite']) {
      const page = await fetch(fixture.origin + path, { headers: { 'x-request-fixture': 'opaque-fixture-id' } })
      expect(page.status).toBe(200)
      expect(page.headers.get('referrer-policy')).toBe('no-referrer')
      const html = await page.text()
      expect(html).toContain('opaque-fixture-id')
      expect(html).toContain(new URL(fixture.origin).host)
      expect(html).not.toContain('operator-only-fixture')
      expect(html).not.toContain('operator-tap-fixture')
    }
    expect((await fetch(fixture.origin + '/unknown')).status).toBe(404)
    release()
    expect((await fetch(fixture.origin)).status).toBe(503)
    const nextRelease = fixture.ctx.webServer.registerRequestIndexRenderer(render)
    release()
    expect((await fetch(fixture.origin)).status).toBe(200)
    nextRelease()
  })

  it('refuses HTML completed after its request-renderer registration was disposed', async () => {
    const fixture = await serve('authenticated')
    let started!: () => void
    let finish!: (html: string) => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    const pending = new Promise<string>((resolve) => { finish = resolve })
    const release = fixture.ctx.webServer.registerRequestIndexRenderer(async () => { started(); return pending })
    const response = fetch(fixture.origin)
    await entered
    release()
    finish('<html><body>late-private-fixture</body></html>')
    const refused = await response
    expect(refused.status).toBe(503)
    expect(await refused.text()).not.toContain('late-private-fixture')
  })
})
