/** A transport bridge to a real child-process HTTP server, never an auth adapter. */
import { vi } from 'vitest'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BrowserFixtureControl, BrowserFixtureFactory } from '../../../../examples/web-identity/tests/browser-fixture.contract.ts'
/** Load the real Node fixture at runtime while its provider remains outside the Client type program. */
export async function browserFixture(audience: 'user' | 'admin', firstPassword = false,
  frontend = false, projectRuntime = false): Promise<BrowserFixtureControl> {
  const require = createRequire(pathToFileURL(resolve(process.cwd(), 'package.json')))
  const module: unknown = require(resolve(process.cwd(), 'examples/web-identity/tests/browser-fixture.host.ts'))
  if (!isFixtureModule(module)) throw new Error('real HTTP fixture factory unavailable')
  const ready: unknown = await module.browserFixture(audience, firstPassword, frontend, projectRuntime)
  if (!isFixtureControl(ready) || ready.audience !== audience) throw new Error('real HTTP fixture control contract invalid')
  return ready
}
function isFixtureModule(value: unknown): value is {
  readonly browserFixture: (...args: Parameters<BrowserFixtureFactory>) => Promise<unknown>
} {
  return typeof value === 'object' && value !== null && 'browserFixture' in value && typeof value.browserFixture === 'function'
}

function isFixtureControl(value: unknown): value is BrowserFixtureControl {
  if (typeof value !== 'object' || value === null || !('url' in value) || typeof value.url !== 'string'
    || !('audience' in value) || (value.audience !== 'user' && value.audience !== 'admin')
    || !('masterPassword' in value) || typeof value.masterPassword !== 'string'
    || !('users' in value) || !Array.isArray(value.users)
    || !('command' in value) || typeof value.command !== 'function'
    || !('close' in value) || typeof value.close !== 'function') return false
  if ('adminUrl' in value && value.adminUrl !== undefined && typeof value.adminUrl !== 'string') return false
  if (!value.users.every((row: unknown) => typeof row === 'object' && row !== null
    && 'username' in row && typeof row.username === 'string' && 'password' in row && typeof row.password === 'string')) return false
  if (!('resolution' in value) || value.resolution === undefined) return true
  const resolution = value.resolution
  return typeof resolution === 'object' && resolution !== null && 'fixtureOnly' in resolution && resolution.fixtureOnly === true
    && 'packages' in resolution && Array.isArray(resolution.packages) && resolution.packages.every((name: unknown) => typeof name === 'string')
}

/** Each jar represents one independent browser context and sends actual HTTP cookies. */
const nativeFetch = globalThis.fetch
export function httpBridge(url: string) {
  let cookie = ''
  const requests: Array<{ method: string; path: string }> = []
  const fetcher: typeof fetch = async (input, init) => {
    const target = typeof input === 'string' ? new URL(input, url) : new URL(input instanceof URL ? input.href : input.url, url)
    const headers = new Headers(init?.headers)
    headers.set('Origin', url)
    if (cookie !== '') headers.set('Cookie', cookie)
    requests.push({ method: init?.method ?? 'GET', path: target.pathname })
    const response = await nativeFetch(target, { ...init, headers })
    const setCookie = response.headers.getSetCookie()
    if (setCookie.length > 0) cookie = setCookie.at(-1)!.split(';')[0]!
    return response
  }
  return {
    fetcher, requests,
    install(): void { vi.stubGlobal('fetch', fetcher) },
    clear(): void { cookie = '' },
  }
}
