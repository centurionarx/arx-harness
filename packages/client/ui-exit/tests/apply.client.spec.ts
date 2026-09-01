/** Exit-seat registration: dictionaries, the occupant, HMR recovery, and the wire call it binds. */
import { Context } from '@arx-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@arx-ai/arx-client-runtime/client'
import { LocaleRuntime } from '@arx-ai/arx-client-locale/client'
import { apply, inject } from '@arx-ai/arx-client-ui-exit/client'
import { ExitRow } from '../src/client/ExitRow.tsx'
import type { ExitRowInjected } from '../src/client/ExitRow.tsx'

async function bench(exitResult: { ok: true; value: { stopping: true } } | { ok: false; error: { code: string } }) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const exit = vi.fn(() => Promise.resolve({ rpcId: 'exit' as never, result: exitResult }))
  ctx.provide('connection', { api: { host: { exit } }, isLoopback: true } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, exit }
}

/** Declare the exit hole the way ui-sidebar's entry does. */
function declare(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { 'sidebar.exit': { kind: 'single', scope: 'root' } } } as never,
    () => null,
  )
}

const stopped = { ok: true as const, value: { stopping: true as const } }

/** The occupant's injected face, which the entry carries beside its component. */
function injectedFace(slots: SlotRegistry): ExitRowInjected {
  const entry = slots.entries('sidebar.exit')[0] as unknown as { inject: () => ExitRowInjected }
  return entry.inject()
}

describe('ui-exit apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the dictionary under the exit namespace', async () => {
    const subject = await bench(stopped)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    expect(subject.locale.bind('exit')('trigger')).toBe('Exit')
  })

  it('fills the seat whether the declaration precedes apply or follows it', async () => {
    const early = await bench(stopped)
    const disposeHole = declare(early.slots)
    await early.ctx.plugin({ inject: [...inject], apply }).await()
    expect(early.slots.entries('sidebar.exit')[0]?.component).toBe(ExitRow)

    const late = await bench(stopped)
    await late.ctx.plugin({ inject: [...inject], apply }).await()
    expect(late.slots.entries('sidebar.exit')).toHaveLength(0)
    declare(late.slots)
    await Promise.resolve()
    expect(late.slots.entries('sidebar.exit')[0]?.component).toBe(ExitRow)

    disposeHole()
  })

  it('withdraws the occupant when the declaration collapses and again on teardown', async () => {
    const subject = await bench(stopped)
    const disposeHole = declare(subject.slots)
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    disposeHole()
    expect(subject.slots.entries('sidebar.exit')).toHaveLength(0)
    declare(subject.slots)
    await Promise.resolve()
    expect(subject.slots.entries('sidebar.exit')).toHaveLength(1)

    await fiber.dispose()
    expect(subject.slots.entries('sidebar.exit')).toHaveLength(0)
  })

  it('binds stop to host.exit and reports the started shutdown', async () => {
    const subject = await bench(stopped)
    declare(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = injectedFace(subject.slots)
    await expect(injected.stop()).resolves.toBe(true)
    expect(subject.exit).toHaveBeenCalledWith({})
  })

  it('reads a transport failure after the ask as the shutdown working', async () => {
    const subject = await bench(stopped)
    subject.exit.mockRejectedValueOnce(new Error('transport failure for /api/host.exit: HTTP 502'))
    declare(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    await expect(injectedFace(subject.slots).stop()).resolves.toBe(true)
  })

  it('reports a refusal as a shutdown that did not start', async () => {
    const subject = await bench({ ok: false, error: { code: 'exit-unavailable' } })
    declare(subject.slots)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = injectedFace(subject.slots)
    await expect(injected.stop()).resolves.toBe(false)
  })
})
