/**
 * SessionRuntime edge behavior: scope tag lookups, disposal failures, catalog
 * menu and generation hooks, fork children that cannot be addressed, list
 * projection of pending interactions, and addressed one-shot subagent routes.
 */
import { Context } from '@arx-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@arx-ai/arx-api-remotes/client'
import { SessionRuntime } from '../src/client/sessions/service.ts'
import { FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'

const sid = (id: string): SessionId => id as SessionId

afterEach(() => {
  vi.restoreAllMocks()
})

function bench(ctx = new Context()) {
  const api = new FakeApiClient()
  const svc = new SessionRuntime(ctx, api, fakeRemote())
  return { ctx, api, svc }
}

type Bench = ReturnType<typeof bench>

const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve()
}

async function feedList(b: Bench, rows: { id: string; parentId?: string; origin?: 'subagent' }[]): Promise<void> {
  b.api.onList = () => Promise.resolve(ok({
    items: rows.map(r => ({
      sessionId: sid(r.id), updatedAt: 1, running: false, blank: false,
      ...(r.parentId === undefined ? {} : { parentSessionId: sid(r.parentId) }),
      ...(r.origin === undefined ? {} : { origin: r.origin }),
    })) as never[],
  }))
  await b.svc.refresh()
  await flush()
}

describe('scope tags', () => {
  it('reads the session id off a scoped context and nothing off the root', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    const scoped = b.svc.scope(sid('s1'))!
    expect(b.svc.scopeOf(scoped)).toBe('s1')
    expect(b.svc.scopeOf(b.ctx)).toBeUndefined()
  })

  it('resolves the session behind a scoped context until its scope is pruned', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }, { id: 's2' }])
    const scoped = b.svc.scope(sid('s2'))!
    expect(b.svc.sessionOf(scoped)).toBe(b.svc.binding(sid('s2'))?.session)
    expect(b.svc.sessionOf(b.ctx)).toBeUndefined()

    b.svc.open(sid('s1'))
    await feedList(b, [{ id: 's1' }])
    expect(b.svc.sessionOf(scoped)).toBeUndefined()
  })
})

describe('runtime hooks', () => {
  it('forwards catalog menu state and generation death to the manager', async () => {
    const b = bench()
    await feedList(b, [{ id: 's1' }])
    b.svc.setSubagentCatalogOpen(sid('s1'), true)
    expect(b.api.callsOf('subagent.list')).toEqual([{ parentSessionId: 's1' }])

    b.svc.handleMuxEnvelope({
      rpcId: 'a' as never,
      payload: { type: 'approval/requested', sessionId: sid('s1'), approvalId: 'ap' as never, toolName: 'rm' },
    })
    await flush()
    expect(b.svc.list.getSnapshot().byId[sid('s1')]?.pendingInteraction).toBe('approval')
    b.svc.handleDisconnected()
    await flush()
    expect(b.svc.list.getSnapshot().byId[sid('s1')]?.pendingInteraction).toBeUndefined()
  })

  it('contains a list-store failure raised while the owning fiber is disposed', async () => {
    const ctx = new Context()
    let built!: Bench
    await ctx.plugin({ name: 'owner', apply: (inner: Context) => { built = bench(inner) } }).await()
    const failure = new Error('store subscriber failed')
    vi.spyOn(built.svc.list, 'set').mockImplementation(() => { throw failure })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await ctx.fiber.dispose()

    expect(logged).toHaveBeenCalledWith('sessions disposal subscriber failed:', failure)
  })
})

describe('fork', () => {
  it('reports a titled fork child that cannot be addressed locally', async () => {
    const b = bench()
    await feedList(b, [{ id: 'source' }])
    b.svc.handleMuxEnvelope({
      rpcId: 't' as never,
      payload: { type: 'session/projection', sessionId: sid('source'), key: 'title', value: 'Plan', seq: 1 } as never,
    })
    await flush()
    b.api.onFork = () => Promise.resolve(ok({ sessionId: sid('child') }))
    vi.spyOn(b.svc, 'binding').mockReturnValue(undefined)
    await expect(b.svc.fork({ sessionId: sid('source'), increaseTitle: true }))
      .rejects.toThrow('fork child "child" is not locally addressable')
    expect(b.api.callsOf('session.rename')).toEqual([])
  })
})

describe('addressed one-shot subagent route', () => {
  const oneShot = { kind: 'one-shot' as const }
  const address = { parentSessionId: sid('root'), childSessionId: sid('child'), mode: oneShot.kind }

  function withCatalog(entries: unknown[]): Bench {
    const b = bench()
    b.api.onSubagentList = () => Promise.resolve(ok({ entries: entries as never[], parentAvailable: false }))
    return b
  }
  const unlabeled = { kind: 'child', id: 'child', mode: 'one-shot', activity: 'inactive', hasChildren: false }

  it('titles an unlisted unlabeled child by its id and drops the route when the catalog no longer lists it', async () => {
    const b = withCatalog([unlabeled])
    await feedList(b, [{ id: 'root' }])
    await b.svc.refreshSubagents(sid('root'))
    b.svc.openSubagent(address)
    await flush()
    expect(b.svc.list.getSnapshot().byId[sid('child')]).toMatchObject({
      displayTitle: 'child', parentId: 'root', origin: 'subagent',
    })

    b.api.onSubagentList = () => Promise.resolve(ok({ entries: [], parentAvailable: false }))
    await b.svc.refreshSubagents(sid('root'))
    await flush()
    expect(b.svc.list.getSnapshot().byId[sid('child')]).toBeUndefined()
  })

  it('keeps a listed child row when its title already matches the catalog route', async () => {
    const b = withCatalog([unlabeled])
    await feedList(b, [{ id: 'root' }, { id: 'child', parentId: 'root', origin: 'subagent' }])
    await b.svc.refreshSubagents(sid('root'))
    b.svc.openSubagent(address)
    await flush()
    expect(b.svc.list.getSnapshot().current).toBe('child')
    expect(b.svc.list.getSnapshot().byId[sid('child')]).toMatchObject({ displayTitle: 'child', origin: 'subagent' })
  })
})
