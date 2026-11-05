// @vitest-environment jsdom
/** SlotRegistry lifecycle edges: delayed injection failures and boot-once installs. */
import { Context } from '@arx-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Slots from '../src/client/index.ts'
import type { LocaleFace, SlotRenderer } from '@arx-ai/arx-client-ui-slots'

declare module '@arx-ai/arx-client-ui-slots' {
  interface SlotMap { 'slots.lifecycle.child': { kind: 'list'; scope: 'root'; owner: object } }
}

const component = (): null => null

async function boot() {
  const ctx = new Context()
  await ctx.plugin(Slots)
  return { ctx }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('delayed slot injection failures', () => {
  it.each([
    ['an Error', new Error('setup failed'), 'setup failed'],
    // Cordis rethrows a stack-bearing non-Error unchanged, so the registry itself must wrap it.
    ['a stack-bearing non-Error object', { stack: 'custom', toString: (): string => 'plain failure' }, 'plain failure'],
  ])('rethrows %s from a delayed setup as an Error on the microtask queue and retires the injection', async (_label, thrown, text) => {
    const { ctx } = await boot()
    const queued: Array<() => void> = []
    vi.stubGlobal('queueMicrotask', (task: () => void) => { queued.push(task) })
    try {
      const setup = vi.fn(() => { throw thrown })
      ctx.slots.inject('slots.lifecycle.child', setup)
      const dispose = ctx.slots.register({
        name: 'root', runtime: 'application', children: { 'slots.lifecycle.child': { kind: 'list', scope: 'root' } },
      } as never, component)
      const failures: unknown[] = []
      for (const task of queued) {
        try { task() } catch (error) { failures.push(error) }
      }
      expect(failures).toHaveLength(1)
      expect(failures[0]).toBeInstanceOf(Error)
      expect((failures[0] as Error).message).toContain(text)
      dispose()
      expect(setup).toHaveBeenCalledTimes(1)
    } finally { await ctx.fiber.dispose() }
  })
})

describe('boot-once face installs', () => {
  it('refuses a second renderer install while the first is installed', async () => {
    const { ctx } = await boot()
    const first: SlotRenderer = { renderRoot: () => null }
    try {
      ctx.slots.install(first)
      expect(() => { ctx.slots.install(first) }).toThrow('already installed')
    } finally { await ctx.fiber.dispose() }
  })

  it('refuses a second locale face install while the first is installed', async () => {
    const { ctx } = await boot()
    try {
      ctx.slots.installLocale({} as LocaleFace)
      expect(() => { ctx.slots.installLocale({} as LocaleFace) }).toThrow('locale face already installed')
    } finally { await ctx.fiber.dispose() }
  })
})
