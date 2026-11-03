// @vitest-environment jsdom
/** Cookie transport distinguishes authentication, authorization and network failures. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity/contract'
import type { RpcFetch } from '../src/client/rpc.ts'
import { authenticatedFetch, ConnectionHttpError } from '../src/client/authenticated-fetch.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('authenticated browser fetch', () => {
  it('returns a typed 401 even when no DOM event dispatcher is present', async () => {
    vi.stubGlobal('dispatchEvent', undefined)
    vi.stubGlobal('fetch', async () => new Response(null, { status: 401 }))
    await expect(authenticatedFetch('fixture-csrf')(new URL('https://app.fixture.test/api/example'), { method: 'HEAD' }))
      .rejects.toMatchObject({ status: 401, name: 'ConnectionHttpError' })
  })

  it('uses only same-origin cookies and an ephemeral CSRF verifier for mutation', async () => {
    const send = vi.fn<RpcFetch>(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', send)
    const transport = authenticatedFetch('fixture-csrf')
    await transport(new URL('https://app.fixture.test/api/host.describe'), { method: 'POST', headers: { 'content-type': 'application/json' } })
    const init = send.mock.calls[0]![1]
    expect(init).toMatchObject({ credentials: 'same-origin', mode: 'same-origin', redirect: 'error' })
    const headers = new Headers(init.headers)
    expect(headers.get(AUTH_HEADER)).toBe('1')
    expect(headers.get(CSRF_HEADER)).toBe('fixture-csrf')
    expect(headers.get('authorization')).toBeNull()
    await transport(new URL('https://app.fixture.test/api/host.describe'), { method: 'GET' })
    expect(new Headers(send.mock.calls[1]![1].headers).has(CSRF_HEADER)).toBe(false)
  })

  it('invalidates the auth shell on 401, preserves a denied module on 403, and keeps network errors distinct', async () => {
    let invalidations = 0
    const listener = () => { invalidations++ }
    globalThis.addEventListener('arx-auth-required', listener)
    try {
      const transport = authenticatedFetch('fixture-csrf')
      vi.stubGlobal('fetch', async () => new Response(null, { status: 401 }))
      await expect(transport(new URL('https://app.fixture.test/api/host.describe'), { method: 'POST' })).rejects.toMatchObject({ name: 'ConnectionHttpError', status: 401 })
      expect(invalidations).toBe(1)
      vi.stubGlobal('fetch', async () => new Response(null, { status: 403 }))
      await expect(transport(new URL('https://app.fixture.test/api/host.describe'), { method: 'POST' })).rejects.toBeInstanceOf(ConnectionHttpError)
      expect(invalidations).toBe(1)
      const failure = new TypeError('fixture network unavailable')
      vi.stubGlobal('fetch', async () => { throw failure })
      await expect(transport(new URL('https://app.fixture.test/api/host.describe'), { method: 'POST' })).rejects.toBe(failure)
      expect(invalidations).toBe(1)
    } finally { globalThis.removeEventListener('arx-auth-required', listener) }
  })
})
