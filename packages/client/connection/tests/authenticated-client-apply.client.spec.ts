/** Authentication composition cannot silently choose fixtures or a foreign transport. */
import { Context } from '@arx-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity/contract'
import type { RpcFetch } from '../src/client/rpc.ts'
import { apply, type ConnectionHandle } from '../src/client/index.ts'
import { WebApiClient } from '../src/client/web-api-client.ts'

function context(): Context { return new Context() }
// These tests never start streams or plugin forks; only the provided handle is observed.
afterEach(() => { vi.unstubAllGlobals() })

describe('authenticated connection composition', () => {
  it('refuses missing auth configuration and a missing or empty CSRF verifier before mounting', () => {
    vi.stubGlobal('__ARX_CLIENT_ACCESS_MODE__', 'authenticated')
    for (const config of [undefined, { accessMode: 'local' as const }]) {
      const ctx = context()
      expect(() =>{  apply(ctx, config) }).toThrow('Authenticated connection configuration is required')
      expect(ctx.get('connection')).toBeUndefined()
    }
    for (const config of [{ accessMode: 'authenticated' as const }, { accessMode: 'authenticated' as const, csrfToken: '' }]) {
      const ctx = context()
      expect(() =>{  apply(ctx, config) }).toThrow('Authenticated CSRF verifier is required')
      expect(ctx.get('connection')).toBeUndefined()
    }
  })

  it('refuses a supplied tunnel before constructing the protected API client', () => {
    vi.stubGlobal('__ARX_CLIENT_ACCESS_MODE__', 'authenticated')
    const createApiClient = vi.fn()
    vi.stubGlobal('__ARX_TRANSPORT__', { createApiClient })
    const ctx = context()
    expect(() =>{  apply(ctx, { accessMode: 'authenticated', csrfToken: 'fixture-verifier' }) }).toThrow('Authenticated connections require the serving-origin transport')
    expect(createApiClient).not.toHaveBeenCalled()
    expect(ctx.get('connection')).toBeUndefined()
  })

  it('ignores the local fixture switch and uses the same cookie carrier for API and generic RPC', async () => {
    vi.stubGlobal('__ARX_CLIENT_ACCESS_MODE__', 'authenticated')
    vi.stubGlobal('location', { origin: 'https://user.fixture.test', hostname: 'localhost', search: '?fixture' })
    const seen: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', async (input: URL, init: RequestInit) => {
      seen.push({ url: input.href, init })
      if (typeof init.body !== 'string') throw new Error('Fixture expected a serialized RPC body')
      const request = JSON.parse(init.body) as { rpcId: string }
      return Response.json({ type: 'server-response', rpcId: request.rpcId,
        result: { ok: false, error: { code: 'bad-request', message: 'fixture carrier receipt', details: { issues: [] } } } })
    })
    const ctx = context()
    apply(ctx, { accessMode: 'authenticated', csrfToken: 'fixture-verifier' })
    const handle = ctx.get('connection') as ConnectionHandle
    expect(handle.api).toBeInstanceOf(WebApiClient)
    expect(handle.accessMode).toBe('authenticated')
    expect(handle.isLoopback).toBe(false)
    expect((await handle.api.host.describe({})).result).toMatchObject({ ok: false })
    expect(await handle.rpc.call('/project-channel', 'example', {})).toMatchObject({ ok: false })
    expect(seen.map(item => item.url)).toEqual([
      'https://user.fixture.test/api/host.describe', 'https://user.fixture.test/project-channel/example',
    ])
    for (const { init } of seen) {
      expect(init).toMatchObject({ credentials: 'same-origin', mode: 'same-origin', redirect: 'error' })
      const headers = new Headers(init.headers)
      expect(headers.get(AUTH_HEADER)).toBe('1')
      expect(headers.get(CSRF_HEADER)).toBe('fixture-verifier')
      expect(headers.has('authorization')).toBe(false)
    }
  })

  it('forwards both explicit and absent Fetch options through a supplied carrier', async () => {
    class Probe extends WebApiClient {
      request(init?: RequestInit): Promise<Response> { return this.doFetch(new URL('https://user.fixture.test/api/example'), init) }
    }
    const send = vi.fn<RpcFetch>(async () => new Response(null))
    const client = new Probe(send)
    await client.request()
    await client.request({ method: 'HEAD' })
    expect(send.mock.calls.map(call => call[1])).toEqual([{}, { method: 'HEAD' }])
  })
})
