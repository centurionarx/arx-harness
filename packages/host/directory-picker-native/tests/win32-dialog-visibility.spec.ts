/** Real Windows regression: a hidden-console worker must show a maximized chooser. */
import { describe, expect, it, vi } from 'vitest'
import { spawnDialogWorker } from '../src/win32-dialog-host.ts'
import { pickWin32Directory } from '../src/win32-dialog.ts'
import type { Win32DialogWorkerMessage } from '../src/win32-dialog-worker.ts'

describe.skipIf(process.platform !== 'win32')('native chooser visibility', () => {
  it('shows its own dialog maximized and closes it on abort', async () => {
    const koffi = (await import('koffi')).default
    const user32 = koffi.load('user32.dll')
    const enumerate = user32.func('int __stdcall EnumThreadWindows(uint32 thread, void *callback, intptr data)')
    const visible = user32.func('int __stdcall IsWindowVisible(void *hwnd)')
    const maximized = user32.func('int __stdcall IsZoomed(void *hwnd)')
    const className = user32.func('int __stdcall GetClassNameW(void *hwnd, void *name, int capacity)')
    const proto = koffi.proto('int __stdcall ArxVisibilityProbe(void *hwnd, intptr data)')
    let dialogThread: number | undefined
    const controller = new AbortController()
    const result = pickWin32Directory(controller.signal, {
      spawnWorker: (data) => {
        const worker = spawnDialogWorker(data)
        worker.on('message', (message: Win32DialogWorkerMessage) => {
          if (message.kind === 'showing') dialogThread = message.threadId
        })
        return worker
      },
    }).then(path => ({ path }), (error: unknown) => ({ error }))
    let observation: { visible: boolean; maximized: boolean } | undefined
    const callback = koffi.register((hwnd: unknown) => {
      const buffer = Buffer.alloc(512)
      const length = className(hwnd, buffer, 256) as number
      if (buffer.toString('utf16le', 0, length * 2) === '#32770') {
        observation = { visible: Boolean(visible(hwnd)), maximized: Boolean(maximized(hwnd)) }
      }
      return 1
    }, koffi.pointer(proto))
    try {
      await vi.waitFor(() => {
        expect(dialogThread).toBeDefined()
        enumerate(dialogThread, callback, 0)
        expect(observation).toEqual({ visible: true, maximized: true })
      }, { timeout: 10_000, interval: 50 })
    } finally {
      koffi.unregister(callback)
      controller.abort()
      await result
    }
    expect(await result).toHaveProperty('error.message', 'native directory picker aborted')
  }, 20_000)
})
