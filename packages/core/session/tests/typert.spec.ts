import { describe, expect, it } from 'vitest'
import { Context } from '@centurionarx/cordis'
import SessionStore, { SessionId } from '@centurionarx/cxh-session'
import TypertRegistry from '@centurionarx/cxh-typert-registry'

describe('Session Typert provider', () => {
  it('contributes live Session lookup in either service load order', async () => {
    const ctx = new Context()
    const sessionFiber = ctx.plugin(SessionStore)
    await sessionFiber
    await ctx.plugin(TypertRegistry)
    const session = ctx.sessions.create(SessionId('remote-session'))

    const lookup = ctx.typert.lookups.get('session')
    expect(lookup).toMatchObject({
      parameter: 'session',
      wire: 'sessionId',
      hostTypeSymbol: '@centurionarx/cxh-session#Session',
      wireTypeSymbol: '@centurionarx/cxh-session/types#SessionId',
    })
    expect(lookup?.resolve(session.id)).toBe(session)

    await sessionFiber.dispose()
    expect(ctx.typert.lookups.get('session')).toBeUndefined()
  })
})
