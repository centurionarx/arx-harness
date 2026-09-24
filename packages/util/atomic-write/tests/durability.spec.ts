import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  calls: [] as { op: string; args: unknown[] }[],
  fail: new Set<string>(),
  counts: new Map<string, number>(),
  directories: new Set<string>(),
  staged: new Map<string, string>(),
  visible: 'old',
  firstCreated: undefined as string | undefined,
  directoryRace: false,
  warning: vi.fn(),
}))

function operation(op: string, ...args: unknown[]): void {
  io.calls.push({ op, args })
  const count = (io.counts.get(op) ?? 0) + 1
  io.counts.set(op, count)
  if (io.fail.has(op) || io.fail.has(`${op}:${count}`)) {
    throw Object.assign(new Error('FAKE_PRIVATE_VALUE'), { code: 'EIO' })
  }
}

function handle(path: string, directory: boolean) {
  const kind = directory ? 'directory' : 'file'
  return {
    writeFile: (text: string) => { operation('file.write', path); io.staged.set(path, text) },
    sync: () => { operation(`${kind}.sync`, path) },
    close: () => { operation(`${kind}.close`, path) },
  }
}

vi.mock('node:fs/promises', () => ({
  mkdir: (path: string, options: unknown) => { operation('mkdir', path, options); return io.firstCreated },
  stat: (path: string) => {
    operation('stat', path)
    if (io.directories.has(path)) return { isDirectory: () => true }
    if (io.staged.has(path)) return { isDirectory: () => false }
    throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  },
  open: (path: string, flags: string, mode?: number) => {
    operation(flags === 'r' ? 'directory.open' : 'file.open', path, flags, mode)
    return handle(path, flags === 'r')
  },
  rename: (source: string, target: string) => {
    operation('rename', source, target)
    io.visible = io.staged.get(source)!
    io.staged.delete(source)
  },
  rm: (path: string) => { operation('rm', path); io.staged.delete(path) },
  rmdir: (path: string) => { operation('rmdir', path); io.directories.delete(path) },
  lstat: vi.fn(), writeFile: vi.fn(),
}))

vi.mock('../src/win32.ts', () => ({
  openPrivateFileWin32: (path: string) => { operation('private.open', path); return handle(path, false) },
  createDirectoryWin32: (path: string, privateDirectory: boolean) => {
    operation('directory.create', path, privateDirectory)
    io.directories.add(path)
  },
  publishWin32: (source: string, target: string, replace: boolean) => {
    operation(replace ? 'file.publish' : 'directory.publish', source, target)
    if (replace) { io.visible = io.staged.get(source)!; io.staged.delete(source) }
    else {
      io.directories.add(target)
      if (io.directoryRace) throw Object.assign(new Error('race'), { code: 'EEXIST' })
      io.directories.delete(source)
    }
  },
}))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const root = resolve('atomic-fixture')
const target = join(root, 'settings.yaml')
const { writeFileAtomic } = await import('../src/index.ts')

function platform(value: 'linux' | 'win32'): void {
  Object.defineProperty(process, 'platform', { ...originalPlatform, value })
}

beforeEach(() => {
  io.calls.length = 0
  io.fail.clear()
  io.counts.clear()
  io.directories.clear()
  io.directories.add(root)
  io.staged.clear()
  io.visible = 'old'
  io.firstCreated = undefined
  io.directoryRace = false
  io.warning.mockReset()
  vi.spyOn(process, 'emitWarning').mockImplementation(io.warning)
  platform('linux')
})

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.restoreAllMocks()
})

describe('atomic replacement commit point', () => {
  it('flushes staged content and closes it before publication, then flushes the parent', async () => {
    await writeFileAtomic(target, 'new', { mode: 0o600 })
    expect(io.calls.map(call => call.op)).toEqual([
      'mkdir', 'directory.open', 'directory.sync', 'file.open', 'file.write',
      'file.sync', 'file.close', 'rename', 'directory.sync', 'directory.close',
    ])
    expect(io.visible).toBe('new')
    expect(io.warning).not.toHaveBeenCalled()
  })

  it.each(['directory.open', 'directory.sync:1', 'file.open', 'file.write', 'file.sync', 'file.close:1', 'rename'])('preserves the destination on pre-commit %s failure', async (op) => {
    io.fail.add(op)
    await expect(writeFileAtomic(target, 'new', { mode: 0o600 })).rejects.toThrow('FAKE_PRIVATE_VALUE')
    expect(io.visible).toBe('old')
    expect(io.staged.size).toBe(0)
  })

  it.each(['directory.sync:2', 'directory.close'])('reports committed content and a sanitized warning after %s fails', async (op) => {
    io.fail.add(op)
    await expect(writeFileAtomic(target, 'secret', { mode: 0o600 })).resolves.toBeUndefined()
    expect(io.visible).toBe('secret')
    expect(io.warning).toHaveBeenCalledWith(expect.stringContaining('no rollback'), { code: 'ATOMIC_WRITE_DURABILITY_UNCONFIRMED' })
    expect(JSON.stringify(io.warning.mock.calls)).not.toMatch(/FAKE_PRIVATE_VALUE|secret/)
  })

  it.each(['file.close', 'rm', 'directory.close'])('preserves the initial failure if %s cleanup also fails', async (op) => {
    io.fail.add('file.sync')
    io.fail.add(op)
    await expect(writeFileAtomic(target, 'secret', { mode: 0o600 })).rejects.toThrow('FAKE_PRIVATE_VALUE')
    expect(io.visible).toBe('old')
    expect(io.warning).toHaveBeenCalledWith(expect.any(String), { code: 'ATOMIC_WRITE_CLEANUP_FAILED' })
    expect(JSON.stringify(io.warning.mock.calls)).not.toMatch(/FAKE_PRIVATE_VALUE|secret/)
  })

  it('flushes every newly created ancestor and preserves the requested directory mode', async () => {
    io.firstCreated = join(root, 'first')
    await writeFileAtomic(join(root, 'first', 'second', 'settings.yaml'), 'new', { mode: 0o600, dirMode: 0o700 })
    expect(io.calls.filter(call => call.op === 'directory.open').map(call => call.args[0]))
      .toEqual([join(root, 'first'), root, join(root, 'first', 'second')])
    expect(io.calls[0]?.args[1]).toEqual({ recursive: true, mode: 0o700 })
  })

  it('closes the ancestor handle if its durability barrier fails', async () => {
    io.firstCreated = join(root, 'first')
    io.fail.add('directory.sync')
    await expect(writeFileAtomic(join(root, 'first', 'settings.yaml'), 'new', { mode: 0o600 })).rejects.toThrow()
    expect(io.calls.at(-1)?.op).toBe('directory.close')
    expect(io.visible).toBe('old')
  })

  it.each([0o600, 0o644])('uses the Windows publication barrier for mode %s', async (mode) => {
    platform('win32')
    await writeFileAtomic(target, 'new', { mode })
    expect(io.calls.map(call => call.op)).toEqual([
      'stat', mode === 0o600 ? 'private.open' : 'file.open',
      'file.write', 'file.sync', 'file.close', 'file.publish',
    ])
    expect(io.visible).toBe('new')
  })

  it('does not remove an unowned private staging path when exclusive creation fails', async () => {
    platform('win32')
    io.fail.add('private.open')
    await expect(writeFileAtomic(target, 'new', { mode: 0o600 })).rejects.toThrow()
    expect(io.calls.some(call => call.op === 'rm')).toBe(false)
  })

  it('creates private Windows ancestors and accepts a concurrently created directory', async () => {
    platform('win32')
    io.directoryRace = true
    await writeFileAtomic(join(root, 'nested', 'settings.yaml'), 'new', { mode: 0o600, dirMode: 0o700 })
    expect(io.calls.find(call => call.op === 'directory.create')?.args[1]).toBe(true)
    expect(io.calls.some(call => call.op === 'rmdir')).toBe(true)
    expect(io.visible).toBe('new')
  })

  it('publishes ordinary Windows ancestors with their inherited policy', async () => {
    platform('win32')
    await writeFileAtomic(join(root, 'nested', 'settings.yaml'), 'new', { mode: 0o600 })
    expect(io.calls.find(call => call.op === 'directory.create')?.args[1]).toBe(false)
  })

  it('preserves directory publication failure when staging cleanup fails', async () => {
    platform('win32')
    io.fail.add('directory.publish')
    io.fail.add('rmdir')
    await expect(writeFileAtomic(join(root, 'nested', 'settings.yaml'), 'new', { mode: 0o600 })).rejects.toThrow('FAKE_PRIVATE_VALUE')
    expect(io.warning).toHaveBeenCalledWith(expect.any(String), { code: 'ATOMIC_WRITE_CLEANUP_FAILED' })
    expect(io.visible).toBe('old')
  })

  it('rejects an unavailable Windows root instead of recursing indefinitely', async () => {
    platform('win32')
    io.directories.clear()
    await expect(writeFileAtomic(target, 'new', { mode: 0o600 })).rejects.toMatchObject({ code: 'ENOENT' })
    expect(io.calls.length).toBeLessThan(20)
  })

  it('rejects a file in the parent position and preserves filesystem errors', async () => {
    platform('win32')
    io.directories.clear()
    io.staged.set(root, 'not a directory')
    await expect(writeFileAtomic(target, 'new', { mode: 0o600 })).rejects.toMatchObject({ code: 'ENOTDIR' })
    io.fail.add('stat')
    await expect(writeFileAtomic(target, 'new', { mode: 0o600 })).rejects.toMatchObject({ code: 'EIO' })
  })
})
