/**
 * ui-open-in-app plugin halves: the browser entry's dictionary and
 * header-utilities registrations against the real SlotRegistry (with fiber
 * teardown proving removal — HMR safety), the once-per-page application read
 * it starts, the inert node entry, and the invariant companion's ownership
 * reservation.
 */
import { Context } from '@arx-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@arx-ai/arx-invariants'
import { SlotRegistry } from '@arx-ai/arx-client-runtime/client'
import { stubSettingsScope } from '@arx-ai/arx-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@arx-ai/arx-client-locale/client'
import { apply, inject, type OpenInAppActionInjected } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as OpenInAppInvariant from '../src/invariant.ts'
import { en, NS } from '../src/client/locales.ts'

/** Slot ledger reader: entry ids currently registered in the header utilities list. */
function utilityIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.session.header.utilities')
    .map(entry => entry.options.id)
}

/** Boot the browser half over a real slot tree that declares the header utilities list. */
async function bench(call: ReturnType<typeof vi.fn>): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port; the same handle carries this plugin's RPC.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: true, rpc: { call } } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('en')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-open-in-app browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('reads the host application list once, and registers the header entry until fiber teardown (HMR safety)', async () => {
    const call = vi.fn(() => Promise.resolve({ ok: true, value: { apps: [] } }))
    const { ctx, fiber } = await bench(call)
    expect(call).toHaveBeenCalledWith('/open-in-app', 'apps', {})
    expect(utilityIds(ctx)).toContain('open-in-app')
    await fiber.dispose()
    expect(utilityIds(ctx)).not.toContain('open-in-app')
  })

  it('binds the header entry to the controller: stores, launch, and choice', async () => {
    const call = vi.fn((_channel: string, endpoint: string) => Promise.resolve(endpoint === 'apps'
      ? { ok: true, value: { apps: ['pwsh'] } }
      : { ok: true, value: endpoint === 'icon' ? { icon: null } : { launched: true } }))
    const { ctx, fiber } = await bench(call)
    // The occupant's injected face rides the entry beside its component.
    const entry = ctx.slots.entries('conversation.session.header.utilities')
      .find(candidate => candidate.options.id === 'open-in-app') as unknown as { inject: () => OpenInAppActionInjected }
    const face = entry.inject()
    await vi.waitFor(() => { expect(face.hooks.openInAppApps.getSnapshot()).toEqual(['pwsh']) })
    await face.launch('pwsh', '/w/dir')
    expect(call).toHaveBeenCalledWith('/open-in-app', 'open', { app: 'pwsh', path: '/w/dir' })
    face.choose('pwsh')
    expect(face.hooks.openInAppChoice.getSnapshot()).toBe('pwsh')
    expect(face.hooks.openInAppIcons.getSnapshot()).toEqual({})
    await fiber.dispose()
  })

  it('registers its dictionary under its own namespace and releases it with the fiber', async () => {
    const { ctx, fiber } = await bench(vi.fn(() => Promise.resolve({ ok: true, value: { apps: [] } })))
    const translate = ctx.locale.bind(NS)
    expect(translate('app.powershell')).toBe(en['app.powershell'])

    await fiber.dispose()
    expect(translate('app.powershell')).not.toBe(en['app.powershell'])
  })
})

describe('ui-open-in-app node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})

describe('ui-open-in-app invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(OpenInAppInvariant)
    await fiber.await()
    expect(OpenInAppInvariant.name).toBe('client-ui-open-in-app-invariant')
    expect(OpenInAppInvariant.inject).toEqual(['invariants'])
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
