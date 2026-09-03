/** Web search section registration: slot declaration injection, the locale-following label thunk, and HMR recovery. */
import { Context } from '@arx-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@arx-ai/arx-client-ui-slots'
import { SlotRegistry } from '@arx-ai/arx-client-runtime/client'
import { LocaleRuntime } from '@arx-ai/arx-client-locale/client'
import { TestRemote } from '@arx-ai/arx-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@arx-ai/arx-client-ui-settings/client'
import { apply, inject, refreshIfLoaded } from '@arx-ai/arx-client-ui-settings-web/client'
import type { WebSectionInjected } from '@arx-ai/arx-client-ui-settings-web/client'
import { WebSection } from '../src/client/WebSection.tsx'

// These specs assert the shipped English copy: without a jsdom `window`,
// browser-language detection never runs and a fresh LocaleRuntime opens on
// the fallback locale, the only one the client ships.

async function bench(services: object = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const remote = new TestRemote(ctx)
  ctx.provide('connection', { api: services, isLoopback: true } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, remote }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

describe('ui-settings-web apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('registers the web nav entry after Models, for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = before.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(WebSection)
    expect(entry.options).toMatchObject({ id: 'web', order: 11 })
    expect(resolveSlotLabel(entry.options.label)).toBe('Web search')
    const injected = (entry.inject as unknown as () => WebSectionInjected)()
    expect(injected.t('nav')).toBe('Web search')
    expect(injected.hooks.snapshot).toBe(injected.controller.store)

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.section')[0]!.component).toBe(WebSection)
    expect(after.slots.entries('settings.section')).toHaveLength(1)
  })

  it('re-registers after an HMR collapse re-declares the slot', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    redeclare()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.section')[0]!.component).toBe(WebSection)
  })

  it('registers the nav dictionary and disposes everything with the fiber', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('settings.web')('nav')).toBe('Web search')
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(() => b.locale.register('settings.web', 'en', {})).not.toThrow()
  })

  it('reloads an open page on every pushed invalidation, and an unopened one on none', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (b.slots.entries('settings.section')[0]!.inject as unknown as () => WebSectionInjected)()
    const load = vi.spyOn(injected.controller, 'load').mockResolvedValue(undefined)
    const push = (): void => {
      b.remote.$dispatch('settings/document-updated', [])
      b.remote.$dispatch('credentials/reference-updated', ['EXA_API_KEY'])
      b.remote.$dispatch('web/providers-updated', [])
      b.ctx.emit('connection/reset')
    }
    push()
    expect(load).not.toHaveBeenCalled()
    injected.controller.store.update((s) => { s.status = 'ready' })
    push()
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('refreshes only a page that has loaded', () => {
    const controller = { store: { getSnapshot: () => ({ status: 'idle' }) }, load: vi.fn(() => Promise.resolve()) }
    refreshIfLoaded(controller as never)
    expect(controller.load).not.toHaveBeenCalled()
    controller.store = { getSnapshot: () => ({ status: 'ready' }) }
    refreshIfLoaded(controller as never)
    expect(controller.load).toHaveBeenCalledTimes(1)
  })
})
