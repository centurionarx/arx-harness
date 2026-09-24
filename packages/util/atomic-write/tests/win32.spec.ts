import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown[] }[],
  fail: new Set<string>(),
  processHandle: 20n as bigint | null,
  fileHandle: 30n as bigint | null,
  error: 5,
  flags: 8,
  chunk: 2,
  moveFailures: 0,
  sid: 'S-1-5-21-123-456-789-1001',
}))

vi.mock('koffi', () => ({
  default: {
    struct: () => 'SECURITY_ATTRIBUTES', pointer: (type: unknown) => type, sizeof: () => 24,
    decode: (buffer: Buffer, type: string) => {
      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(type).toBe('void *')
      return 100n
    },
    view: (address: bigint, length: number) => {
      expect(address).toBe(101n)
      expect(length).toBe(native.sid.length * 2)
      return Uint8Array.from(Buffer.from(native.sid, 'utf16le')).buffer
    },
    load: () => ({
      func: (...declaration: unknown[]) => {
        const name = declaration.length === 1
          ? /__stdcall (\w+)/.exec(String(declaration[0]))![1]!
          : String(declaration[1])
        return (...args: unknown[]) => {
          native.calls.push({ name, args })
          if (name === 'MoveFileExW' && native.moveFailures > 0) { native.moveFailures--; return 0 }
          if (native.fail.has(name)) return 0
          switch (name) {
            case 'OpenProcess': return native.processHandle
            case 'OpenProcessToken': (args[2] as unknown[])[0] = 21n; return 1
            case 'GetTokenInformation':
              (args[4] as number[])[0] = native.fail.has('token-size') ? 0 : 32
              return args[2] === null || native.fail.has('token-data') ? 0 : 1
            case 'ConvertSidToStringSidW': (args[1] as unknown[])[0] = 101n; return 1
            case 'lstrlenW': return native.sid.length
            case 'ConvertStringSecurityDescriptorToSecurityDescriptorW': (args[2] as unknown[])[0] = 200n; return 1
            case 'CreateFileW': return native.fileHandle
            case 'GetVolumeInformationByHandleW': (args[5] as number[])[0] = native.flags; return 1
            case 'WriteFile': (args[3] as number[])[0] = Math.min(native.chunk, Number(args[2])); return 1
            case 'LocalFree': return null
            case 'GetLastError': return native.error
            default: return 1
          }
        }
      },
    }),
  },
}))

beforeEach(() => {
  vi.resetModules()
  native.calls.length = 0
  native.fail.clear()
  native.processHandle = 20n
  native.fileHandle = 30n
  native.error = 5
  native.flags = 8
  native.chunk = 2
  native.moveFailures = 0
})

afterEach(() => { vi.useRealTimers() })

function calls(name: string): unknown[][] {
  return native.calls.filter(call => call.name === name).map(call => call.args)
}

describe('Windows private staging', () => {
  it('sets protected owner-only security before creation, handles partial UTF-8 writes, and flushes', async () => {
    const { openPrivateFileWin32 } = await import('../src/win32.ts')
    const file = await openPrivateFileWin32('private.tmp')
    expect(calls('ConvertStringSecurityDescriptorToSecurityDescriptorW')[0]?.[0])
      .toBe(`O:${native.sid}D:P(A;;FA;;;${native.sid})`)
    expect(calls('CreateFileW')[0]?.slice(1)).toEqual([
      0x40000000, 0, { length: 24, descriptor: 200n, inherit: 0 }, 1, 0x80, null,
    ])
    expect(calls('LocalFree')).toEqual([[101n], [200n]])
    expect(calls('CloseHandle')).toEqual([[21n], [20n]])
    file.writeFile('ábc')
    file.sync()
    file.close()
    expect(calls('WriteFile').map(args => args[2])).toEqual([4, 2])
    expect(native.calls.slice(-2).map(call => call.name)).toEqual(['FlushFileBuffers', 'CloseHandle'])
  })

  it('checks persistent ACL support even for an empty write before emitting any bytes', async () => {
    const { openPrivateFileWin32 } = await import('../src/win32.ts')
    const file = await openPrivateFileWin32('private.tmp')
    file.writeFile('')
    expect(calls('WriteFile')).toHaveLength(0)
    native.flags = 0
    expect(() => { file.writeFile('secret') }).toThrow(/persistent Windows ACLs/)
    expect(calls('WriteFile')).toHaveLength(0)
    file.close()
  })

  it.each(['GetVolumeInformationByHandleW', 'WriteFile', 'FlushFileBuffers', 'CloseHandle'])('surfaces %s failures', async (name) => {
    const { openPrivateFileWin32 } = await import('../src/win32.ts')
    const file = await openPrivateFileWin32('private.tmp')
    native.fail.add(name)
    expect(() => {
      if (name === 'CloseHandle') file.close()
      else if (name === 'FlushFileBuffers') file.sync()
      else file.writeFile('private')
    }).toThrow(name)
  })

  it('rejects a zero-progress write instead of spinning', async () => {
    const { openPrivateFileWin32 } = await import('../src/win32.ts')
    const file = await openPrivateFileWin32('private.tmp')
    native.chunk = 0
    expect(() => { file.writeFile('private') }).toThrow('no progress')
    file.close()
  })

  it.each([null, 0n, -1n, 0xffffffffffffffffn, 0xffffffffn])('rejects invalid file handle %s and releases the descriptor', async (handle) => {
    const { openPrivateFileWin32 } = await import('../src/win32.ts')
    native.fileHandle = handle
    await expect(openPrivateFileWin32('private.tmp')).rejects.toMatchObject({ code: 'EACCES', syscall: 'CreateFileW' })
    expect(calls('LocalFree').at(-1)).toEqual([200n])
  })

  it.each([null, 0n])('rejects unavailable current process %s before allocating security', async (handle) => {
    const { openPrivateFileWin32 } = await import('../src/win32.ts')
    native.processHandle = handle
    await expect(openPrivateFileWin32('private.tmp')).rejects.toThrow('OpenProcess')
    expect(calls('CreateFileW')).toHaveLength(0)
  })

  it.each(['OpenProcessToken', 'token-size', 'GetTokenInformation', 'token-data', 'ConvertSidToStringSidW', 'CloseHandle', 'ConvertStringSecurityDescriptorToSecurityDescriptorW'])('rejects security discovery failure %s before creating a file', async (name) => {
    const { openPrivateFileWin32 } = await import('../src/win32.ts')
    native.fail.add(name)
    await expect(openPrivateFileWin32('private.tmp')).rejects.toMatchObject({ code: 'EACCES' })
    expect(calls('CreateFileW')).toHaveLength(0)
    expect(calls('CloseHandle').at(-1)).toEqual([20n])
  })

  it('creates inheritable private directories without changing ordinary directory policy', async () => {
    const { createDirectoryWin32 } = await import('../src/win32.ts')
    await createDirectoryWin32('private', true)
    expect(calls('ConvertStringSecurityDescriptorToSecurityDescriptorW')[0]?.[0])
      .toBe(`O:${native.sid}D:P(A;OICI;FA;;;${native.sid})`)
    await createDirectoryWin32('ordinary', false)
    expect(calls('CreateDirectoryW').at(-1)?.[1]).toBeNull()
    native.fail.add('CreateDirectoryW')
    await expect(createDirectoryWin32('denied', true)).rejects.toThrow('CreateDirectoryW')
    expect(calls('LocalFree').at(-1)).toEqual([200n])
  })

  it.each([5, 32, 33])('retries transient Win32 denial %s with the same paths and flags', async (code) => {
    const { publishWin32 } = await import('../src/win32.ts')
    await publishWin32('source', 'target', true)
    native.calls.length = 0
    native.error = code
    native.moveFailures = 2
    vi.useFakeTimers()
    const result = publishWin32('source', 'target', true)
    await vi.runAllTimersAsync()
    await result
    const moves = calls('MoveFileExW')
    expect(moves).toHaveLength(3)
    expect(moves.every(args => JSON.stringify(args) === JSON.stringify(moves[0]))).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds permanent access denial without changing permissions or falling back to copying', async () => {
    const { publishWin32 } = await import('../src/win32.ts')
    await publishWin32('source', 'target', true)
    native.calls.length = 0
    native.fail.add('MoveFileExW')
    vi.useFakeTimers()
    const result = publishWin32('source', 'target', true).catch((error: unknown) => error)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ code: 'EACCES', win32Code: 5 })
    expect(calls('MoveFileExW')).toHaveLength(6)
    expect(calls('MoveFileExW').every(args => args[2] === 9)).toBe(true)
    expect(calls('ConvertStringSecurityDescriptorToSecurityDescriptorW')).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('publishes with write-through and replacement only when requested', async () => {
    const { publishWin32 } = await import('../src/win32.ts')
    await publishWin32('source', 'target', true)
    await publishWin32('directory', 'parent', false)
    expect(calls('MoveFileExW').map(args => args[2])).toEqual([9, 8])
    native.fail.add('MoveFileExW')
    native.error = 17
    await expect(publishWin32('source', 'other-volume', true)).rejects.toMatchObject({ code: 'EXDEV' })
    native.error = 12345
    await expect(publishWin32('source', 'target', true)).rejects.toMatchObject({ code: 'EIO', win32Code: 12345 })
  })
})
