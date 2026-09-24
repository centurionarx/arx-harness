import { describe, expect, it, vi } from 'vitest'
import type { IApiClient, SettingsNamespaceView } from '@arx-ai/arx-api-remotes/client'
import type { SettingsDescribeFace } from '@arx-ai/arx-client-ui-settings/client'
import { DefaultModelDirectory } from '../src/client/default-directory.ts'

const groups = [{ id: 'configured', name: 'Configured', models: [{ id: 'model-a', name: 'Model A' }] }]
function bench() {
  let view = { ns: 'agent-default-model', revision: 7, value: { provider: 'configured', model: 'old', reasoningEffort: 'high' } } as SettingsNamespaceView
  const models = vi.fn(async () => ({ result: { ok: true, value: { groups, failures: [] } } }))
  const replace = vi.fn(async () => ({ result: { ok: true, value: { ...view, revision: 8, value: { provider: 'configured', model: 'model-a' } } } }))
  const acceptView = vi.fn((next: SettingsNamespaceView) => { view = next })
  const settings = {
    ensure: vi.fn(async () => {}),
    getSnapshot: () => ({ view: { writable: true, namespaces: [view] } }),
    acceptView,
  } as unknown as SettingsDescribeFace
  const controller = new DefaultModelDirectory({ llm: { models }, settings: { replace } } as unknown as IApiClient, settings)
  return { controller, models, replace, settings, acceptView }
}

describe('default model before a session', () => {
  it('loads the real global catalog and atomically replaces the default without stale effort', async () => {
    const b = bench()
    await b.controller.load()
    expect(b.controller.store.getSnapshot()).toMatchObject({ groups, current: { model: 'old', reasoningEffort: 'high' } })
    await b.controller.select({ provider: 'configured', model: 'model-a' })
    expect(b.replace).toHaveBeenCalledWith({ ns: 'agent-default-model', expectedRevision: 7, section: { provider: 'configured', model: 'model-a' } })
    expect(b.acceptView).toHaveBeenCalledOnce()
    expect(b.controller.store.getSnapshot().current).toEqual({ provider: 'configured', model: 'model-a' })
  })

  it('keeps an empty configured catalog empty', async () => {
    const b = bench()
    b.models.mockResolvedValueOnce({ result: { ok: true, value: { groups: [], failures: [] } } })
    await b.controller.load()
    expect(b.controller.store.getSnapshot().groups).toEqual([])
  })

  it('reports rejected writes without replacing the current selection', async () => {
    const b = bench()
    await b.controller.load()
    b.replace.mockRejectedValueOnce(new Error('revision conflict'))
    await expect(b.controller.select({ provider: 'configured', model: 'model-a' })).rejects.toThrow('revision conflict')
    expect(b.controller.store.getSnapshot()).toMatchObject({ current: { model: 'old' }, status: 'error', error: 'revision conflict' })
    expect(b.acceptView).not.toHaveBeenCalled()
  })

  it('discards a catalog response that arrives after selection or disposal', async () => {
    const b = bench()
    let finish!: (value: Awaited<ReturnType<typeof b.models>>) => void
    b.models.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const load = b.controller.load()
    await b.controller.select({ provider: 'configured', model: 'model-a' })
    finish({ result: { ok: true, value: { groups, failures: [] } } })
    await load
    expect(b.controller.store.getSnapshot().current?.model).toBe('model-a')
    b.models.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = b.controller.load()
    const before = b.controller.store.getSnapshot()
    b.controller.dispose()
    finish({ result: { ok: true, value: { groups: [], failures: [] } } })
    await pending
    expect(b.controller.store.getSnapshot()).toBe(before)
  })
})
