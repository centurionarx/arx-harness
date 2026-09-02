import { describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '@arx-ai/arx-api-remotes/client'
import { SettingsDescribeMirror } from '@arx-ai/arx-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'

/** Store over a real mirror derived from the same fake wire. */
function derivedDocumentStore(api: object) {
  const wire = api as never
  return new SettingsDocumentStore(wire, new SettingsDescribeMirror(wire))
}

function response(options: {
  hasDocument?: boolean
  canOpen?: boolean
  documentPath?: string
} = {}): RpcResponse<{
  writable: boolean
  hasDocument: boolean
  documentPath?: string
  canOpen?: boolean
  namespaces: []
}> {
  return {
    rpcId: 'settings-document' as never,
    result: {
      ok: true,
      value: {
        writable: true,
        hasDocument: options.hasDocument ?? false,
        ...options.documentPath === undefined ? {} : { documentPath: options.documentPath },
        ...options.canOpen === undefined ? {} : { canOpen: options.canOpen },
        namespaces: [],
      },
    },
  }
}

function opened(): RpcResponse<{ opened: true }> {
  return {
    rpcId: 'settings-open' as never,
    result: { ok: true, value: { opened: true } },
  }
}

function describeFailed(message: string): RpcResponse<never> {
  return {
    rpcId: 'settings-document-failed' as never,
    result: { ok: false, error: { code: 'internal', message, details: {} } },
  }
}

describe('SettingsDocumentStore', () => {
  it('loads provider metadata and asks the settings domain to open its document', async () => {
    const describe = vi.fn(() => Promise.resolve(response({ hasDocument: true, canOpen: true, documentPath: '/h/settings.yaml' })))
    const openDocument = vi.fn(() => Promise.resolve(opened()))
    const controller = derivedDocumentStore({ settings: { describe, openDocument } })
    await controller.load()
    expect(controller.store.getSnapshot()).toEqual({
      status: 'ready', opening: false, canOpen: true, documentPath: '/h/settings.yaml', error: null,
    })
    await controller.open()
    expect(openDocument).toHaveBeenCalledWith({})
  })

  it('treats an older view without the open capability as openable', async () => {
    const openDocument = vi.fn(() => Promise.resolve(opened()))
    const controller = derivedDocumentStore({
      settings: { describe: () => Promise.resolve(response({ hasDocument: true })), openDocument },
    })
    await controller.load()
    expect(controller.store.getSnapshot().canOpen).toBe(true)
  })

  it('keeps a headless deployment ready with its path but never opens', async () => {
    const openDocument = vi.fn(() => Promise.resolve(opened()))
    const controller = derivedDocumentStore({
      settings: {
        describe: () => Promise.resolve(response({
          hasDocument: true, canOpen: false, documentPath: '/home/arx/.arx/settings.yaml',
        })),
        openDocument,
      },
    })
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', canOpen: false, documentPath: '/home/arx/.arx/settings.yaml',
    })
    await controller.open()
    expect(openDocument).not.toHaveBeenCalled()
  })

  it('marks absent or failed metadata unavailable without opening anything', async () => {
    const openDocument = vi.fn(() => Promise.resolve(opened()))
    const absent = derivedDocumentStore({
      settings: { describe: () => Promise.resolve(response()), openDocument },
    })
    await absent.load()
    await absent.open()
    expect(absent.store.getSnapshot().status).toBe('unavailable')
    expect(openDocument).not.toHaveBeenCalled()

    const failed = derivedDocumentStore({
      settings: { describe: () => Promise.reject(new Error('offline')), openDocument },
    })
    await failed.load()
    expect(failed.store.getSnapshot()).toMatchObject({ status: 'unavailable', error: 'offline' })

    const rejected = derivedDocumentStore({
      settings: { describe: () => Promise.resolve(describeFailed('provider failed')), openDocument },
    })
    await rejected.load()
    expect(rejected.store.getSnapshot()).toMatchObject({
      status: 'unavailable', error: 'provider failed',
    })
  })

  it('collapses concurrent open gestures and recovers after a failure', async () => {
    let resolveOpen!: (response: RpcResponse<{ opened: true }>) => void
    const openDocument = vi.fn(() => new Promise<RpcResponse<{ opened: true }>>((resolve) => { resolveOpen = resolve }))
    const controller = derivedDocumentStore({
      settings: { describe: () => Promise.resolve(response({ hasDocument: true, canOpen: true })), openDocument },
    })
    await controller.load()
    const first = controller.open()
    const second = controller.open()
    expect(openDocument).toHaveBeenCalledOnce()
    resolveOpen({
      rpcId: 'settings-open-failed' as never,
      result: { ok: false, error: { code: 'internal', message: 'no default editor', details: {} } },
    })
    await Promise.all([first, second])
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', opening: false, error: 'no default editor',
    })
  })

  it('reports non-Error native failures and recovers availability via a mirror refresh', async () => {
    let rejectOpen!: (reason?: unknown) => void
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve(response({ hasDocument: true, canOpen: true }))),
        openDocument: () => new Promise((_, reject) => { rejectOpen = reject }),
      },
    })
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
    const opening = controller.open()
    rejectOpen('native unavailable')
    await opening
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', opening: false, error: 'native unavailable',
    })

    // A first read that failed leaves the action unavailable with the miss
    // recorded; the mirror's next refresh (a commit or reconnect) recovers it.
    const wire = {
      settings: {
        describe: vi.fn()
          .mockRejectedValueOnce(new Error('offline'))
          .mockResolvedValueOnce(response({ hasDocument: true, canOpen: true })),
        openDocument: vi.fn(),
      },
    } as never
    const mirror = new SettingsDescribeMirror(wire)
    const caught = new SettingsDocumentStore(wire, mirror)
    await caught.load()
    expect(caught.store.getSnapshot()).toMatchObject({ status: 'unavailable', error: 'offline' })
    await mirror.load()
    expect(caught.store.getSnapshot()).toMatchObject({ status: 'ready', error: null })
  })
})
