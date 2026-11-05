/** Package entry and identity-tree invariant, exercised through a hand-built invariant registry. */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@arx-ai/cordis'
import * as entry from '../src/index.ts'
import * as invariant from '../src/invariant.ts'

type Dispatch = (mode: string, eventName: string) => void
function install(provided: Record<string, unknown>) {
  const fail = vi.fn()
  let installer: ((ctx: unknown, fail: (message: string) => void) => void) | undefined
  const dispose = vi.fn()
  const names: string[] = []
  const register = (name: string, fn: typeof installer): () => void => { names.push(name); installer = fn; return dispose }
  const root = { invariants: { register } }
  const registered = invariant.apply(root as unknown as Context)
  const listeners: Array<{ handler: Dispatch; options: unknown; event: string }> = []
  const child = {
    get: (name: string) => provided[name],
    on: (event: string, handler: Dispatch, options: unknown) => { listeners.push({ event, handler, options }) },
  }
  installer!(child, fail)
  return { fail, listeners, registered, dispose, names }
}
const dispatch = (listeners: ReturnType<typeof install>['listeners'], eventName: string): void => {
  expect(listeners).toHaveLength(1)
  listeners[0]!.handler('after', eventName)
}

describe('package entry', () => {
  it('has no browser-independent activation work', () => {
    expect(() => { entry.apply({}) }).not.toThrow()
  })
})

describe('identity tree invariant', () => {
  it('registers under the package name and resolves to the registration disposer', async () => {
    const t = install({})
    await expect(t.registered).resolves.toBe(t.dispose)
    expect(t.names).toEqual(['@arx-ai/arx-client-ui-auth'])
    expect(t.listeners[0]).toMatchObject({ event: 'internal/dispatch', options: { global: true } })
  })

  it.each(['sessions', 'workspaces', 'connection'])('fails a public or administrative tree that gains a %s service', (service) => {
    for (const kind of ['public', 'admin']) {
      const t = install({ clientComposition: { kind }, [service]: {} })
      dispatch(t.listeners, 'slots/changed')
      expect(t.fail).toHaveBeenCalledWith('public/admin identity composition contains project services')
    }
  })

  it('accepts a public or administrative tree without project services', () => {
    for (const kind of ['public', 'admin']) {
      const t = install({ clientComposition: { kind } })
      dispatch(t.listeners, 'slots/changed')
      expect(t.fail).not.toHaveBeenCalled()
    }
  })

  it('ignores user trees, trees without a composition, and unrelated events', () => {
    const user = install({ clientComposition: { kind: 'user' }, sessions: {}, workspaces: {}, connection: {} })
    dispatch(user.listeners, 'slots/changed')
    const none = install({ sessions: {} })
    dispatch(none.listeners, 'slots/changed')
    const other = install({ clientComposition: { kind: 'public' }, sessions: {} })
    dispatch(other.listeners, 'other/event')
    expect(user.fail).not.toHaveBeenCalled()
    expect(none.fail).not.toHaveBeenCalled()
    expect(other.fail).not.toHaveBeenCalled()
  })
})
