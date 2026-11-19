/** Same-origin cookie transport with ephemeral CSRF and typed auth failures. */
import { AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity/contract'
import type { RpcFetch } from './rpc.ts'

/** An authorization response is distinct from an unavailable network. */
export class ConnectionHttpError extends Error {
  /** @param status - Authentication or authorization status from the serving origin. */
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? 'Authentication required' : 'Access forbidden')
    this.name = 'ConnectionHttpError'
  }
}

/**
 * Create the authenticated carrier without bearer tokens or persistent browser state.
 * @param csrfToken - The live session's ephemeral server-issued CSRF verifier.
 * @returns The same fetch boundary used by the API and generic RPC callers.
 */
export function authenticatedFetch(csrfToken: string): RpcFetch {
  return async (input, init) => {
    const headers = new Headers(init.headers)
    headers.set(AUTH_HEADER, '1')
    if (init.method !== 'GET' && init.method !== 'HEAD') headers.set(CSRF_HEADER, csrfToken)
    const response = await globalThis.fetch(input, { ...init, headers, credentials: 'same-origin', mode: 'same-origin', redirect: 'error' })
    if (response.status === 401) {
      if (typeof globalThis.dispatchEvent === 'function') globalThis.dispatchEvent(new Event('arx-auth-required'))
    }
    if (response.status === 401 || response.status === 403) throw new ConnectionHttpError(response.status)
    return response
  }
}
