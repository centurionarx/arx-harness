/** Notifier disposal edges: frame marks after dispose and a listener that ends its owner mid-flush. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Notifier } from '../src/client/sessions/notifier.ts'

describe('Notifier disposal', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('ignores frame-dirty marks after dispose', async () => {
    const rebuild = vi.fn()
    const request = vi.fn()
    vi.stubGlobal('requestAnimationFrame', request)
    const notifier = new Notifier(rebuild)
    notifier.dispose()
    notifier.markFrameDirty()
    await Promise.resolve()
    expect(request).not.toHaveBeenCalled()
    expect(rebuild).not.toHaveBeenCalled()
  })

  it('stops notifying remaining listeners once a listener disposes the notifier', () => {
    const notifier = new Notifier(() => {})
    const after = vi.fn()
    notifier.subscribe(() => { notifier.dispose() })
    notifier.subscribe(after)
    notifier.notifyNow()
    expect(after).not.toHaveBeenCalled()
  })
})
