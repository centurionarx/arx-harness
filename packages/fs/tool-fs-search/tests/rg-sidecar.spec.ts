import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { dependencyRgPath, existsSync } = vi.hoisted(() => ({
  dependencyRgPath: '/node_modules/@vscode/ripgrep/bin/rg',
  existsSync: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync }
})

vi.mock('@vscode/ripgrep', () => ({ rgPath: dependencyRgPath }))

beforeEach(() => {
  vi.resetModules()
  existsSync.mockReset()
  Reflect.deleteProperty(process, 'pkg')
})

afterEach(() => {
  Reflect.deleteProperty(process, 'pkg')
})

/**
 * Run a case as a packaged runtime on one platform: the sidecar name depends
 * on the platform, so each case pins it rather than inheriting the host's.
 */
async function asPackagedRuntime(platform: NodeJS.Platform, body: () => Promise<void>): Promise<void> {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  Reflect.defineProperty(process, 'pkg', { configurable: true, value: {} })
  try {
    await body()
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform as PropertyDescriptor)
    Reflect.deleteProperty(process, 'pkg')
  }
}

describe('ripgrep resolution', () => {
  it('uses the native sidecar beside the current executable', async () => {
    await asPackagedRuntime('linux', async () => {
      existsSync.mockReturnValue(true)
      const sidecar = `${process.execPath}-rg`
      const { resolveRgPath } = await import('@arx-ai/arx-tool-fs-search')

      await expect(resolveRgPath()).resolves.toBe(sidecar)
      expect(existsSync).toHaveBeenCalledWith(sidecar)
    })
  })

  it('uses the dependency binary in an ordinary Node process', async () => {
    existsSync.mockReturnValue(true)
    const { resolveRgPath } = await import('@arx-ai/arx-tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(dependencyRgPath)
    expect(existsSync).not.toHaveBeenCalled()
  })

  it('uses the dependency binary when a packaged runtime has no sidecar', async () => {
    await asPackagedRuntime('linux', async () => {
      existsSync.mockReturnValue(false)
      const { resolveRgPath } = await import('@arx-ai/arx-tool-fs-search')

      await expect(resolveRgPath()).resolves.toBe(dependencyRgPath)
      expect(existsSync).toHaveBeenCalledWith(`${process.execPath}-rg`)
    })
  })

  it('names the windows sidecar with the spawnable .exe twin', async () => {
    await asPackagedRuntime('win32', async () => {
      existsSync.mockReturnValue(true)
      const { resolveRgPath } = await import('@arx-ai/arx-tool-fs-search')

      const sidecar = `${process.execPath}-rg.exe`
      await expect(resolveRgPath()).resolves.toBe(sidecar)
      expect(existsSync).toHaveBeenCalledWith(sidecar)
    })
  })
})
