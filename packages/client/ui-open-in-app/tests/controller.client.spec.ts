// @vitest-environment jsdom
/**
 * OpenInAppController over a scripted connection: the once-per-page list and
 * icon reads, the loopback gate, wire validation of each answer, the launch
 * call's success and failure, and the persisted choice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenInAppController, type OpenInAppConnection } from '../src/client/controller.ts'

afterEach(() => {
  localStorage.clear()
})

type Call = OpenInAppConnection['rpc']['call']

/** A connection whose `call` answers from a per-endpoint script. */
function connection(
  answer: (endpoint: string, payload: unknown) => ReturnType<Call>,
  isLoopback = true,
): { handle: OpenInAppConnection; call: ReturnType<typeof vi.fn<Call>> } {
  const call = vi.fn<Call>((_channel, endpoint, payload) => answer(endpoint, payload))
  return { handle: { isLoopback, rpc: { call } }, call }
}

const PNG = 'data:image/png;base64,AAAA'

describe('OpenInAppController', () => {
  it('publishes the list, then each icon, reading once for concurrent loads', async () => {
    const { handle, call } = connection((endpoint, payload) => {
      if (endpoint === 'apps') return Promise.resolve({ ok: true, value: { apps: ['vscode', 7, 'gitbash'] } })
      const app = (payload as { app: string }).app
      return Promise.resolve({ ok: true, value: { icon: app === 'vscode' ? PNG : null } })
    })
    const controller = new OpenInAppController(handle)
    expect(controller.apps.getSnapshot()).toBeNull()

    await Promise.all([controller.load(), controller.load()])

    expect(controller.apps.getSnapshot()).toEqual(['vscode', 'gitbash'])
    expect(controller.icons.getSnapshot()).toEqual({ vscode: PNG })
    expect(call.mock.calls.map(([channel, endpoint, payload]) => [channel, endpoint, payload])).toEqual([
      ['/open-in-app', 'apps', {}],
      ['/open-in-app', 'icon', { app: 'vscode' }],
      ['/open-in-app', 'icon', { app: 'gitbash' }],
    ])
  })

  it('asks nothing off loopback and reads every failed or malformed list as no applications', async () => {
    const offLoopback = connection(() => Promise.reject(new Error('unreachable')), false)
    const quiet = new OpenInAppController(offLoopback.handle)
    await quiet.load()
    expect(quiet.apps.getSnapshot()).toEqual([])
    expect(offLoopback.call).not.toHaveBeenCalled()

    for (const answer of [
      () => Promise.reject(new Error('HTTP 403')),
      () => Promise.resolve({ ok: false, error: { code: 'internal', message: 'down', details: {} } }),
      () => Promise.resolve({ ok: true, value: null }),
      () => Promise.resolve({ ok: true, value: { apps: 'vscode' } }),
    ] as const) {
      const controller = new OpenInAppController(connection(answer as never).handle)
      await controller.load()
      expect(controller.apps.getSnapshot()).toEqual([])
    }
  })

  it('keeps the generic glyph for an icon read that fails or answers anything but an image data URL', async () => {
    const icons: Record<string, () => ReturnType<Call>> = {
      a: () => Promise.reject(new Error('HTTP 500')),
      b: () => Promise.resolve({ ok: false, error: { code: 'open-unavailable', message: 'gone', details: {} } }),
      c: () => Promise.resolve({ ok: true, value: { icon: 'https://example.test/icon.png' } }),
      d: () => Promise.resolve({ ok: true, value: 'data:image/png;base64,AAAA' }),
    }
    const { handle } = connection((endpoint, payload) => endpoint === 'apps'
      ? Promise.resolve({ ok: true, value: { apps: Object.keys(icons) } })
      : icons[(payload as { app: string }).app]!())
    const controller = new OpenInAppController(handle)
    await controller.load()
    expect(controller.icons.getSnapshot()).toEqual({})
  })

  it('launches through the channel and rejects with the host message', async () => {
    const { handle, call } = connection((_endpoint, payload) => {
      const { app } = payload as { app: string }
      return Promise.resolve(app === 'vscode'
        ? { ok: true, value: { launched: true } }
        : { ok: false, error: { code: 'internal', message: `failed to launch ${app}`, details: {} } })
    })
    const controller = new OpenInAppController(handle)
    await expect(controller.launch('vscode', '/w/dir')).resolves.toBeUndefined()
    expect(call).toHaveBeenCalledWith('/open-in-app', 'open', { app: 'vscode', path: '/w/dir' })
    await expect(controller.launch('gitbash', '/w/dir')).rejects.toThrow('failed to launch gitbash')
  })

  it('remembers the chosen application across controller lives', () => {
    const { handle } = connection(() => Promise.resolve({ ok: true, value: { apps: [] } }))
    new OpenInAppController(handle).choose('pwsh')
    expect(new OpenInAppController(handle).choice.getSnapshot()).toBe('pwsh')
  })
})
