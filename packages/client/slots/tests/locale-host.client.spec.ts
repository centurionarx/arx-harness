// @vitest-environment jsdom
/** Locale provider reload keeps the cached renderer host and reads its live face. */
import { Context } from '@arx-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { ConnectionHandle } from '@arx-ai/arx-api-remotes/client'
import type { SlotRendererHost } from '@arx-ai/arx-client-ui-slots'
import TypertRegistry from '@arx-ai/arx-typert-registry'
import { LocaleRuntime } from '../../locale/src/client/index.ts'
import * as RuntimeClient from '../../runtime/src/client/index.ts'
import { FakeApiClient, fakeRemote } from '../../runtime/tests/fake-api.client.ts'
import * as Slots from '../src/client/index.ts'

declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap { 'locale.reload': 'text' }
}
const root = (): null => null

async function mount(runtime: 'application' | 'project'): Promise<Context> {
  const ctx = new Context()
  if (runtime === 'application') ctx.provide('clientComposition', {
    kind: 'public', audience: 'user', scope: 'application',
  })
  await ctx.plugin(Slots)
  if (runtime === 'project') {
    await ctx.plugin(TypertRegistry)
    const connection: ConnectionHandle = {
      api: new FakeApiClient(), isLoopback: true,
      hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} },
      rpc: { call: () => Promise.reject(new Error('unexpected RPC in locale reload')) },
      start: () => ({ stop() {} }),
    }
    const remote = fakeRemote()
    ctx.reflect.provide('connection', connection)
    ctx.reflect.provide('remote', remote)
    ctx.reflect.provide('remote.commands', remote.commands)
    await ctx.plugin(RuntimeClient)
  }
  return ctx
}
function provider(text: string) {
  return { inject: ['slots'], apply(ctx: Context) {
    const locale = new LocaleRuntime(ctx)
    locale.register('locale.reload', { en: { text }, pt: { text: text + '-pt' } })
    ctx.provide('locale', locale)
    ctx.slots.installLocale(locale)
  } }
}

describe('SlotRendererHost live locale', () => {
  it.each(['application', 'project'] as const)('retains %s host identity across real provider unload/reload', async (runtime) => {
    const ctx = await mount(runtime)
    try {
      let host: SlotRendererHost | undefined
      ctx.slots.install({ renderRoot(value) { host = value; return null } })
      ctx.slots.register({ name: 'root', runtime: 'application' }, root)
      const firstFiber = ctx.plugin(provider('first'))
      await firstFiber
      ctx.slots.renderSlot('root', {})
      const stable = host
      if (stable === undefined || stable.locale === undefined) throw new Error('locale host missing')
      const first = stable.locale
      expect(first.bind('locale.reload')('text')).toBe('first')
      await firstFiber.dispose()
      expect(stable.locale).toBeUndefined()
      const secondFiber = ctx.plugin(provider('second'))
      await secondFiber
      ctx.slots.renderSlot('root', {})
      expect(host).toBe(stable)
      expect(host?.runtime).toBe(runtime)
      expect(stable.locale).not.toBe(first)
      expect(stable.locale?.bind('locale.reload')('text')).toBe('second')
      const revision = stable.locale?.getSnapshot().revision
      ctx.locale.setLocale('pt')
      expect(stable.locale?.getSnapshot().revision).toBeGreaterThan(revision)
      expect(stable.locale?.bind('locale.reload')('text')).toBe('second-pt')
      if (runtime === 'application') {
        expect(ctx.get('sessions')).toBeUndefined()
        expect(ctx.get('workspaces')).toBeUndefined()
      }
    } finally { await ctx.fiber.dispose() }
  })
})
