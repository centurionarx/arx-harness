// @vitest-environment jsdom
/** Framework-only boundaries: presentation metadata is never authentication authority. */
import { Context } from '@arx-ai/cordis'
import type { ReactNode } from 'react'
import InvariantRegistry from '@arx-ai/arx-invariants'
import { describe, expect, it, vi } from 'vitest'
import * as Slots from '../src/client/index.ts'
import * as SlotsHost from '../src/index.ts'
import * as SlotsInvariant from '../src/invariant.ts'
import type { PropsApplication, PropsRenderSlots, SlotRendererHost } from '@arx-ai/arx-client-ui-slots'
import { defineStore } from '../src/client/store.ts'
import { LocaleRuntime } from '../../locale/src/client/index.ts'
declare module '@arx-ai/arx-client-ui-slots' {
  interface SlotMap { 'slots.test.application': { kind: 'list'; scope: 'root'; owner: object } }
}
const emptyRoot = (): null => null
const declaringRoot = (props: PropsApplication<'root'> & PropsRenderSlots<'slots.test.application'>): ReactNode =>
  props.renderSlot('slots.test.application', {})
const emptyChild = (_props: PropsApplication<'slots.test.application'>): null => null
async function application() {
  const ctx = new Context()
  ctx.provide('clientComposition', { kind: 'public', audience: 'user', scope: 'application' })
  await ctx.plugin(Slots)
  return ctx
}
describe('neutral slot framework ownership and failure boundaries', () => {
  it('keeps Host slots inert and rejects project contributions before committing an entry', async () => {
    const host = new Context(); await host.plugin(SlotsHost)
    expect(host.get('slots')).toBeUndefined(); await host.fiber.dispose()
    const ctx = await application()
    try {
      expect(() => { ctx.slots.register({ name: 'root' }, emptyRoot) }).toThrow('application composition rejects project slot')
      expect(ctx.slots.entries('root')).toHaveLength(0)
      for (const name of ['sessions', 'workspaces', 'connection'] as const) expect(ctx.get(name)).toBeUndefined()
    } finally { await ctx.fiber.dispose() }
  })
  it('shares the live inspection/error/subscription faces and prunes root stores without project services', async () => {
    const ctx = await application()
    try {
      let host: SlotRendererHost | undefined
      ctx.slots.install({ renderRoot(value) { host = value; return null } })
      const changed = vi.fn(), reported = vi.fn()
      const stop = ctx.slots.subscribe('root', changed), stopError = ctx.slots.onEntryError(reported)
      const store = defineStore({ init: () => ({ value: 1 }), actions: {} })
      const dropRoot = ctx.slots.register({ name: 'root', runtime: 'application', store,
        children: { 'slots.test.application': { kind: 'list', scope: 'root' } } }, declaringRoot)
      const dropChild = ctx.slots.register({ name: 'slots.test.application', runtime: 'application', id: 'application' }, emptyChild)
      ctx.slots.renderSlot('root', {})
      const face = host
      if (face === undefined) throw new Error('real slot host was not materialized')
      expect(face.runtime).toBe('application')
      expect(ctx.slots.entriesOfSlot('slots.test.application')).toHaveLength(1)
      expect(ctx.slots.snapshot('root')[0]?.name).toBe('root')
      const entry = ctx.slots.entries('slots.test.application')[0]!
      face.reportEntryError('slots.test.application', entry, new Error('component failure'), { abdicate: true })
      expect(reported).toHaveBeenCalledOnce()
      expect(ctx.slots.entriesOfSlot('slots.test.application')).toHaveLength(0)
      expect(face.storeOf(ctx.slots.entries('root')[0]!, undefined)?.getSnapshot()).toEqual({ value: 1 })
      ctx.slots.pruneStoreScope('unrelated-session')
      expect(face.storeOf(ctx.slots.entries('root')[0]!, undefined)?.getSnapshot()).toEqual({ value: 1 })
      await Promise.resolve(); expect(changed).toHaveBeenCalled()
      dropChild(); dropChild(); stop(); stopError(); dropRoot(); dropRoot()
    } finally { await ctx.fiber.dispose() }
  })
  it('stamps root, unnamed descendant, named ancestor and explicit registration ownership', async () => {
    const ctx = await application()
    try {
      ctx.slots.register({ name: 'root', runtime: 'application',
        children: { 'slots.test.application': { kind: 'list', scope: 'root' } } }, declaringRoot)
      ctx.slots.register({ name: 'slots.test.application', runtime: 'application', id: 'root-owner' }, emptyChild)
      const unnamed = ctx.inject(['slots'], (scope) => {
        scope.slots.register({ name: 'slots.test.application', runtime: 'application', id: 'unnamed-owner' }, emptyChild)
      })
      await unnamed.await()
      const named = await ctx.plugin({ name: 'named-registration-owner', inject: ['slots'], apply(scope: Context) {
        scope.inject(['slots'], (descendant) => {
          descendant.slots.register({ name: 'slots.test.application', runtime: 'application', id: 'ancestor-owner' }, emptyChild)
        })
      } })
      await named.await()
      ctx.slots.register({ name: 'slots.test.application', runtime: 'application', id: 'explicit-owner',
        registrant: 'explicit-registration-owner' }, emptyChild)
      const registrations = ctx.slots.entries('slots.test.application')
      for (const [id, owner] of [['root-owner', 'root'], ['unnamed-owner', 'root'],
        ['ancestor-owner', 'named-registration-owner'], ['explicit-owner', 'explicit-registration-owner']]) {
        expect(registrations.find(entry => entry.options.id === id)?.registrant).toBe(owner)
      }
    } finally { await ctx.fiber.dispose() }
  })
  it('preserves a replacement contribution when an older public disposer is called again', async () => {
    const ctx = await application()
    try {
      ctx.slots.register({ name: 'root', runtime: 'application',
        children: { 'slots.test.application': { kind: 'list', scope: 'root' } } }, declaringRoot)
      const firstStore = defineStore({ init: () => ({ value: 1 }), actions: {} })
      const replacementStore = defineStore({ init: () => ({ value: 2 }), actions: {} })
      const dropFirst = ctx.slots.register({ name: 'slots.test.application', runtime: 'application',
        id: 'same-position', store: firstStore }, emptyChild)
      expect(ctx.slots.entries('slots.test.application')).toHaveLength(1)
      dropFirst()
      const dropReplacement = ctx.slots.register({ name: 'slots.test.application', runtime: 'application',
        id: 'same-position', store: replacementStore }, emptyChild)
      const replacement = ctx.slots.entries('slots.test.application')[0]
      expect(replacement?.store).toBe(replacementStore)
      dropFirst()
      expect(ctx.slots.entries('slots.test.application')).toEqual([replacement])
      expect(ctx.slots.snapshot('slots.test.application')).toHaveLength(1)
      dropReplacement()
      expect(ctx.slots.entries('slots.test.application')).toHaveLength(0)
    } finally { await ctx.fiber.dispose() }
  })
  it('rejects duplicate locale providers and rendering without genuine project services', async () => {
    const ctx = await application()
    try {
      const locale = new LocaleRuntime(ctx)
      ctx.slots.installLocale(locale)
      expect(() => { ctx.slots.installLocale(locale) }).toThrow('locale face already installed')
    } finally { await ctx.fiber.dispose() }
    const project = new Context(); await project.plugin(Slots)
    try {
      project.slots.install({ renderRoot() { return null } })
      project.slots.register({ name: 'root' }, emptyRoot)
      expect(() => { project.slots.renderSlot('root', {}) }).toThrow('before the sessions service mounted')
    } finally { await project.fiber.dispose() }
  })
  it('validates event ordering and malformed keys through the real invariant companion', async () => {
    const ctx = await application()
    try {
      await ctx.plugin(InvariantRegistry)
      await ctx.plugin(SlotsInvariant)
      expect(() => { ctx.events.dispatch('emit', ['slots/changed']) }).toThrow('without a slot key argument')
      expect(() => { ctx.events.dispatch('emit', ['slots/changed', '']) }).toThrow('without a slot key argument')
      expect(() => { ctx.emit('slots/changed', 'root') }).toThrow('before any mutation bumped its version')
      ctx.slots.register({ name: 'root', runtime: 'application' }, emptyRoot)
      expect(() => { ctx.emit('slots/changed', 'root') }).not.toThrow()
    } finally { await ctx.fiber.dispose() }
    const withoutSlots = new Context(); await withoutSlots.plugin(InvariantRegistry); await withoutSlots.plugin(SlotsInvariant)
    expect(() => { withoutSlots.emit('slots/changed', 'root') }).not.toThrow()
    await withoutSlots.fiber.dispose()
  })
})
