// @vitest-environment jsdom
/** Real USER Loader/worker HTTP receipts cannot refill an ended client owner. */
import { Context } from '@arx-ai/cordis'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { AUTH_HEADER, parseAuthState } from '@arx-ai/arx-web-identity/contract'
import * as Connection from '../../connection/src/client/index.ts'
import * as Gateway from '../../../api/gateway/src/client/index.ts'
import * as Remotes from '../../../api/remotes/src/client/index.ts'
import * as Registry from '../../../typert/registry/src/client/index.ts'
import { Session } from '../src/client/sessions/session.ts'
import { SessionRuntime } from '../src/client/sessions/service.ts'
import { WorkspaceRuntime } from '../src/client/workspaces/service.ts'
import { browserFixture, httpBridge } from '../../ui-auth/tests/http-fixture.client.ts'
import type { SessionId, WorkspaceId } from '@arx-ai/arx-api-remotes/client'
import { deferred } from './fake-api.client.ts'

let fixture: Awaited<ReturnType<typeof browserFixture>>
let seeded: Record<string, unknown>
const cleanup: Array<() => Promise<void>> = []
beforeAll(async () => {
  fixture = await browserFixture('user', false, true, true)
  seeded = await fixture.command('seed-history', { index: 0 })
})
afterAll(async () => { await fixture.close() })
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear()
})
async function entered() {
  const bridge = httpBridge(fixture.url)
  const response = await bridge.fetcher('/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: '1' },
    body: JSON.stringify({ identifier: fixture.users[0]!.username, password: fixture.users[0]!.password }) })
  expect(response.ok).toBe(true)
  const state = parseAuthState(await response.json())
  if (!state.authenticated || state.csrfToken === undefined) throw new Error('real issuer did not authenticate fixture USER')
  const held = new Set<string>(), reached = new Set<string>(), failures = new Map<string, string>(), release = deferred<undefined>()
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === 'string' ? new URL(input, fixture.url) : new URL(input instanceof URL ? input.href : input.url)
    const actual = await bridge.fetcher(target.pathname + target.search, init)
    const method = target.pathname.replace('/api/', '')
    if (held.has(method)) {
      const json = actual.json.bind(actual)
      vi.spyOn(actual, 'json').mockImplementation(async () => {
        const value: unknown = await json()
        expect(actual.status).toBe(200)
        if (typeof value !== 'object' || value === null || !('result' in value)
          || typeof value.result !== 'object' || value.result === null || !('ok' in value.result) || value.result.ok !== true) {
          const error = typeof value === 'object' && value !== null && 'result' in value
            && typeof value.result === 'object' && value.result !== null && 'error' in value.result
            ? value.result.error : undefined
          const code = typeof error === 'object' && error !== null && 'code' in error
            && typeof error.code === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(error.code) ? error.code : 'unknown'
          failures.set(method, code)
          throw new Error('real ' + method + ' response did not succeed: ' + code)
        }
        if (method === 'session.history') expect(JSON.stringify(value)).toContain('Registro próprio 0')
        reached.add(method)
        await release.promise
        return value
      })
    }
    return actual
  })
  cleanup.push(async () => { release.resolve(undefined) })
  const ctx = new Context()
  cleanup.push(() => ctx.fiber.dispose())
  await ctx.plugin(Registry).await()
  await ctx.plugin(Connection, { accessMode: 'authenticated', csrfToken: state.csrfToken }).await()
  await ctx.plugin(Gateway).await()
  await ctx.plugin(Remotes).await()
  let sessions!: SessionRuntime, workspaces!: WorkspaceRuntime
  const owner = ctx.plugin({ name: 'fixture-client-object-owner', inject: ['connection', 'remote'], apply(ctx: Context) {
    const connection = ctx.get('connection') as Connection.ConnectionHandle | undefined
    if (connection === undefined) throw new Error('production connection missing')
    sessions = new SessionRuntime(ctx, connection.api, ctx.remote)
    workspaces = new WorkspaceRuntime(ctx, connection.api, sessions)
  } })
  await owner.await()
  return { ctx, owner, sessions, workspaces, held, reached, release, bridge, failures }
}
describe('real HTTP client object lifetime', () => {
  it('discards real owner baselines after its context ends', async () => {
    const bench = await entered()
    await bench.sessions.refresh(); await bench.workspaces.refresh()
    bench.held.add('session.list'); bench.held.add('workspace.list')
    const pending = [bench.sessions.refresh(), bench.workspaces.refresh()]
    await waitFor(() => { expect([...bench.reached].sort()).toEqual(['session.list', 'workspace.list']) })
    await bench.owner.dispose()
    const seen = vi.fn()
    bench.sessions.list.subscribe(seen); bench.workspaces.list.subscribe(seen)
    bench.release.resolve(undefined)
    await Promise.all(pending)
    expect(bench.sessions.list.getSnapshot().ids).toEqual([])
    expect(bench.workspaces.list.getSnapshot().items).toEqual([])
    expect(seen).not.toHaveBeenCalled()
    expect(bench.bridge.requests.filter(row => row.path === '/api/session.list')).toHaveLength(2)
    expect(bench.bridge.requests.filter(row => row.path === '/api/workspace.list')).toHaveLength(2)
  })

  it('rejects real authorized create and fork receipts after its context ends', async () => {
    const bench = await entered()
    await bench.sessions.refresh()
    expect(bench.sessions.list.getSnapshot().ids).toContain(seeded.sessionId)
    const source = bench.sessions.binding(seeded.sessionId as SessionId)?.session as Session | undefined
    if (source === undefined) throw new Error('authorized real fork source absent')
    await source.open()
    bench.held.add('session.create'); bench.held.add('session.fork')
    // Complete the worker mutations in sequence; both authorized receipts stay held at the client.
    const fork = Promise.allSettled([bench.sessions.fork({ sessionId: seeded.sessionId as SessionId })])
    await waitFor(() => { expect([...bench.failures]).toEqual([]); expect(bench.reached.has('session.fork')).toBe(true) }, { timeout: 5000 })
    const create = Promise.allSettled([bench.sessions.create({ workspaceId: seeded.workspaceId as WorkspaceId })])
    await waitFor(() => { expect([...bench.failures]).toEqual([]); expect([...bench.reached].sort()).toEqual(['session.create', 'session.fork']) }, { timeout: 5000 })
    await bench.owner.dispose(); bench.release.resolve(undefined)
    for (const result of (await Promise.all([create, fork])).flat()) {
      expect(result.status).toBe('rejected')
      if (result.status !== 'rejected' || !(result.reason instanceof Error)) throw new Error('ended client operation did not reject')
      expect(result.reason.message).toContain('disposed')
    }
    expect(bench.sessions.list.getSnapshot().ids).toEqual([])
  })

  it('does not reinstall a real private history window into the old Session after owner disposal', async () => {
    const bench = await entered()
    await bench.sessions.refresh()
    const binding = bench.sessions.binding(seeded.sessionId as SessionId)
    if (binding === undefined) throw new Error('real owner Session absent from authorized baseline')
    const old = binding.session as Session
    bench.held.add('session.history')
    const pending = old.open()
    await waitFor(() => { expect(bench.reached.has('session.history')).toBe(true) })
    await bench.owner.dispose()
    const seen = vi.fn(); old.subscribe(seen)
    bench.release.resolve(undefined); await pending
    expect(old.getSnapshot()).toMatchObject({ openState: 'cold', nodes: [], pending: [], queue: [], running: false })
    expect(old.projections.faceOf('title').getSnapshot()).toBeUndefined()
    expect(seen).not.toHaveBeenCalled()
    const requests = bench.bridge.requests.length
    await old.open(); await old.resync(); await old.loadOlder()
    expect(bench.bridge.requests).toHaveLength(requests)
  })
})
