import { Context, FiberState } from '@arx-ai/cordis'
import { expect, it, vi } from 'vitest'

declare module '@arx-ai/cordis' {
  interface Context {
    criticResource: { write(value: string): void }
    criticMiddle: { write(value: string): void }
  }
}

it('retains a two-hop injected service until leaf cleanup finishes during ancestor disposal', async () => {
  const ctx = new Context()
  const release = Promise.withResolvers<undefined>()
  const draining = Promise.withResolvers<undefined>()
  const events: string[] = []
  const errors: unknown[] = []
  ctx.logger.error = ((error: unknown) => { errors.push(error) }) as typeof ctx.logger.error
  let closed = false
  await ctx.plugin({
    apply(inner: Context) {
      inner.effect(function* () {
        yield () => { closed = true; events.push('resource closed') }
        yield inner.provide('criticResource', {
          write(value: string) {
            if (closed) throw new Error('resource closed before final write')
            events.push(value)
          },
        })
      })
    },
  })
  await ctx.plugin({
    inject: ['criticResource'],
    apply(inner: Context) {
      inner.effect(function* () {
        yield () => { events.push('middle closed') }
        yield inner.provide('criticMiddle', { write(value: string) { inner.criticResource.write(value) } })
      })
    },
  })
  const leaf = await ctx.plugin({
    inject: ['criticMiddle'],
    apply(inner: Context) {
      inner.effect(() => async () => {
        draining.resolve(undefined)
        await release.promise
        inner.criticMiddle.write('final write')
      })
    },
  })
  const unloading = ctx.fiber.dispose()
  try {
    await draining.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(closed).toBe(false)
    expect(leaf.state).toBe(FiberState.UNLOADING)
  } finally {
    release.resolve(undefined)
    await unloading
  }
  expect(errors).toEqual([])
  expect(events).toEqual(['final write', 'middle closed', 'resource closed'])
  expect(leaf.state).toBe(FiberState.DISPOSED)
})

it('does not reactivate a disposed consumer when a replacement service arrives during its cleanup', async () => {
  const ctx = new Context()
  const release = Promise.withResolvers<undefined>()
  const draining = Promise.withResolvers<undefined>()
  const originalWrite = vi.fn()
  const replacementWrite = vi.fn()
  let activations = 0
  const provider = await ctx.plugin({
    apply(inner: Context) { inner.provide('criticResource', { write: originalWrite }) },
  })
  const consumer = await ctx.plugin({
    inject: ['criticResource'],
    apply(inner: Context) {
      activations++
      inner.effect(() => async () => {
        draining.resolve(undefined)
        await release.promise
        inner.criticResource.write('cleanup uses original')
      })
    },
  })
  const unloading = Promise.all([consumer.dispose(), provider.dispose()])
  try {
    await draining.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    ctx.provide('criticResource', { write: replacementWrite })
    expect(activations).toBe(1)
    expect(consumer.uid).toBeNull()
  } finally {
    release.resolve(undefined)
    await unloading
    await ctx.fiber.dispose()
  }
  expect(originalWrite).toHaveBeenCalledExactlyOnceWith('cleanup uses original')
  expect(replacementWrite).not.toHaveBeenCalled()
  expect(activations).toBe(1)
  expect(consumer.state).toBe(FiberState.DISPOSED)
})

it('does not make one root wait for a different root consumer with the same service name', async () => {
  const left = new Context()
  const right = new Context()
  const release = Promise.withResolvers<undefined>()
  const draining = Promise.withResolvers<undefined>()
  let leftClosed = false
  let rightClosed = false
  for (const ctx of [left, right]) {
    await ctx.plugin({
      apply(inner: Context) {
        inner.effect(function* () {
          yield () => { if (ctx === left) leftClosed = true; else rightClosed = true }
          yield inner.provide('criticResource', { write() {} })
        })
      },
    })
  }
  await left.plugin({
    inject: ['criticResource'],
    apply(inner: Context) {
      inner.effect(() => async () => { draining.resolve(undefined); await release.promise })
    },
  })
  const closingLeft = left.fiber.dispose()
  try {
    await draining.promise
    await right.fiber.dispose()
    expect(rightClosed).toBe(true)
    expect(leftClosed).toBe(false)
  } finally {
    release.resolve(undefined)
    await closingLeft
    await right.fiber.dispose()
  }
  expect(leftClosed).toBe(true)
})
