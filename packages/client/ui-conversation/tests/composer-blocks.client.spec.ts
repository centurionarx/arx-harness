/**
 * The per-session composer-block registry: a blocker may raise before the
 * composer mounts, equal blocks notify nobody — a fresh `run` closure included
 * — and a changed reason or action label reaches the composer.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@arx-ai/arx-client-runtime/client'
import { ComposerBlockRegistry } from '../src/client/input/blocks.ts'

const sid = (key: string): SessionId => key as SessionId

describe('ComposerBlockRegistry', () => {
  it('holds a block raised before the composer reads it', () => {
    const blocks = new ComposerBlockRegistry()
    blocks.set(sid('s1'), { reason: 'Select a model to start' })
    expect(blocks.storeFor(sid('s1')).getSnapshot()).toEqual({ reason: 'Select a model to start' })
    expect(blocks.storeFor(sid('s2')).getSnapshot()).toBeUndefined()
  })

  it('notifies only when the reason or the action label changes', () => {
    const blocks = new ComposerBlockRegistry()
    const store = blocks.storeFor(sid('s1'))
    const listener = vi.fn()
    store.subscribe(listener)
    const action = (run: () => void) => ({ label: 'Set up a model provider', run })

    blocks.set(sid('s1'), { reason: 'Set up a model provider to start', action: action(() => {}) })
    blocks.set(sid('s1'), { reason: 'Set up a model provider to start', action: action(() => {}) })
    expect(listener).toHaveBeenCalledTimes(1)

    blocks.set(sid('s1'), { reason: 'Set up a model provider to start' })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot()?.action).toBeUndefined()

    blocks.set(sid('s1'), undefined)
    blocks.set(sid('s1'), undefined)
    expect(listener).toHaveBeenCalledTimes(3)
    expect(store.getSnapshot()).toBeUndefined()
  })

  it('forgets a torn-down session, so a later read starts clear', () => {
    const blocks = new ComposerBlockRegistry()
    blocks.set(sid('s1'), { reason: 'Select a model to start' })
    blocks.forget(sid('s1'))
    expect(blocks.storeFor(sid('s1')).getSnapshot()).toBeUndefined()
  })
})
