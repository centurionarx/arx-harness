/**
 * Private staging and write-through publication on Windows. Koffi and the DLLs
 * load only on the Windows path; no filesystem provider or subprocess is used.
 * @module @arx-ai/arx-atomic-write/win32
 */

import { toNamespacedPath } from 'node:path'

// Koffi 3 represents pointers as BigInt addresses; buffers remain GC-owned.
type Pointer = bigint | null
interface SecurityAttributes { length: number; descriptor: Pointer; inherit: number }

async function loadBindings() {
  const koffi = (await import('koffi')).default
  const kernel = koffi.load('kernel32.dll')
  const security = koffi.load('advapi32.dll')
  const attributes = koffi.struct({ length: 'uint32', descriptor: 'void *', inherit: 'int' })
  const stringLength = kernel.func('int __stdcall lstrlenW(const void *text)') as (value: Pointer) => number
  return {
    decodePointer: (value: Buffer) => koffi.decode(value, 'void *') as Pointer,
    // ConvertSidToStringSidW returns character storage, not a pointer-to-string.
    decodeString: (value: Pointer) => Buffer.from(koffi.view(value, stringLength(value) * 2)).toString('utf16le'),
    attributesSize: koffi.sizeof(attributes),
    openProcess: kernel.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)') as (access: number, inherit: number, pid: number) => Pointer,
    openProcessToken: security.func('int __stdcall OpenProcessToken(void *process, uint32_t access, _Out_ void **token)') as (process: Pointer, access: number, token: [Pointer]) => number,
    getTokenInformation: security.func('int __stdcall GetTokenInformation(void *token, int kind, void *buffer, uint32_t size, _Out_ uint32_t *needed)') as (token: Pointer, kind: number, buffer: Buffer | null, size: number, needed: [number]) => number,
    sidToString: security.func('int __stdcall ConvertSidToStringSidW(void *sid, _Out_ void **text)') as (sid: Pointer, text: [Pointer]) => number,
    descriptorFromString: security.func('int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(const char16_t *text, uint32_t revision, _Out_ void **descriptor, void *size)') as (text: string, revision: number, descriptor: [Pointer], size: null) => number,
    createFile: kernel.func('__stdcall', 'CreateFileW', 'void *', ['str16', 'uint32', 'uint32', koffi.pointer(attributes), 'uint32', 'uint32', 'void *']) as (path: string, access: number, share: number, attributes: SecurityAttributes, disposition: number, flags: number, template: null) => Pointer,
    createDirectory: kernel.func('__stdcall', 'CreateDirectoryW', 'int', ['str16', koffi.pointer(attributes)]) as (path: string, attributes: SecurityAttributes | null) => number,
    volumeInformation: kernel.func('int __stdcall GetVolumeInformationByHandleW(void *handle, void *name, uint32_t length, void *serial, void *maximum, _Out_ uint32_t *flags, void *filesystem, uint32_t filesystemLength)') as (handle: Pointer, name: null, length: number, serial: null, maximum: null, flags: [number], filesystem: null, filesystemLength: number) => number,
    writeFile: kernel.func('int __stdcall WriteFile(void *handle, const void *buffer, uint32_t length, _Out_ uint32_t *written, void *overlapped)') as (handle: Pointer, buffer: Buffer, length: number, written: [number], overlapped: null) => number,
    flush: kernel.func('int __stdcall FlushFileBuffers(void *handle)') as (handle: Pointer) => number,
    close: kernel.func('int __stdcall CloseHandle(void *handle)') as (handle: Pointer) => number,
    free: kernel.func('void * __stdcall LocalFree(void *memory)') as (memory: Pointer) => Pointer,
    move: kernel.func('int __stdcall MoveFileExW(const char16_t *source, const char16_t *target, uint32_t flags)') as (source: string, target: string, flags: number) => number,
    lastError: kernel.func('uint32_t __stdcall GetLastError()') as () => number,
  }
}

// Watchers and scanners may briefly deny rename without changing file permissions.
// Bound this local retry policy below the ordinary writer-lock acquisition budget.
const RENAME_RETRY_DELAYS_MS = [20, 40, 80, 160, 200] as const

type Bindings = Awaited<ReturnType<typeof loadBindings>>
let bindingPromise: Promise<Bindings> | undefined
function win32(): Promise<Bindings> {
  return bindingPromise ??= loadBindings()
}

function nativeError(api: Bindings, syscall: string, path: string): NodeJS.ErrnoException & { win32Code: number } {
  const win32Code = api.lastError()
  const codes: Record<number, string> = { 2: 'ENOENT', 3: 'ENOENT', 5: 'EACCES', 17: 'EXDEV', 80: 'EEXIST', 183: 'EEXIST' }
  const code = codes[win32Code] ?? 'EIO'
  return Object.assign(new Error(
    `atomic-write: ${syscall} ${code} (Win32 ${win32Code}): ${path}`,
  ), { code, syscall, path, win32Code })
}

function checked(api: Bindings, result: number, syscall: string, path: string): void {
  if (result === 0) throw nativeError(api, syscall, path)
}

function currentUserSid(api: Bindings): string {
  const processHandle = api.openProcess(0x1000, 0, process.pid) // PROCESS_QUERY_LIMITED_INFORMATION
  if (processHandle === null || processHandle === 0n) throw nativeError(api, 'OpenProcess', 'current process')
  const token: [Pointer] = [null]
  try {
    checked(api, api.openProcessToken(processHandle, 0x0008, token), 'OpenProcessToken', 'current user')
    try {
      const needed: [number] = [0]
      api.getTokenInformation(token[0], 1, null, 0, needed) // TokenUser size probe
      if (needed[0] === 0) throw nativeError(api, 'GetTokenInformation', 'current user')
      const user = Buffer.alloc(needed[0])
      checked(api, api.getTokenInformation(token[0], 1, user, user.length, needed), 'GetTokenInformation', 'current user')
      const text: [Pointer] = [null]
      checked(api, api.sidToString(api.decodePointer(user), text), 'ConvertSidToStringSidW', 'current user')
      try {
        return api.decodeString(text[0])
      } finally {
        api.free(text[0]) // LocalFree owns the successful conversion's allocation, never file data.
      }
    } finally {
      checked(api, api.close(token[0]), 'CloseHandle', 'current user token')
    }
  } finally {
    checked(api, api.close(processHandle), 'CloseHandle', 'current process')
  }
}

function withPrivateDescriptor<T>(api: Bindings, directory: boolean, action: (attributes: SecurityAttributes) => T): T {
  const sid = currentUserSid(api)
  const descriptor: [Pointer] = [null]
  // Explicit owner avoids an elevated token's default Administrators owner.
  const sddl = 'O:' + sid + 'D:P(A;' + (directory ? 'OICI' : '') + ';FA;;;' + sid + ')'
  checked(api, api.descriptorFromString(sddl, 1, descriptor, null), 'ConvertStringSecurityDescriptorToSecurityDescriptorW', 'private staging')
  try {
    return action({ length: api.attributesSize, descriptor: descriptor[0], inherit: 0 })
  } finally {
    api.free(descriptor[0])
  }
}

/** An exclusively held private staging file; the caller owns close and unlink. */
export interface PrivateFileWin32 {
  /** Write UTF-8 bytes only after proving the opened volume enforces ACLs. */
  writeFile(content: string): void
  /** Flush the staged bytes before publication. */
  sync(): void
  /** Release the native handle before rename or unlink. */
  close(): void
}

/**
 * Create an empty staging file with a protected current-user-only DACL and no
 * sharing. An existing entry is never opened. The caller must unlink on failure.
 * @param path - unused random staging pathname in the destination directory.
 * @returns the owned native file, whose write checks persistent ACL support.
 */
export async function openPrivateFileWin32(path: string): Promise<PrivateFileWin32> {
  const api = await win32()
  const handle = withPrivateDescriptor(api, false, (attributes) => {
    const value = api.createFile(
      toNamespacedPath(path), 0x40000000, 0, attributes, 1, 0x80, null, // GENERIC_WRITE, CREATE_NEW
    )
    if (value === null || value === 0n || value === -1n || value === 0xffffffffffffffffn || value === 0xffffffffn) {
      throw nativeError(api, 'CreateFileW', path)
    }
    return value
  })
  return {
    writeFile(content) {
      const flags: [number] = [0]
      checked(api, api.volumeInformation(handle, null, 0, null, null, flags, null, 0), 'GetVolumeInformationByHandleW', path)
      if ((flags[0] & 0x00000008) === 0) { // FILE_PERSISTENT_ACLS
        throw Object.assign(new Error('atomic-write: private writes require a filesystem with persistent Windows ACLs'), { code: 'ENOTSUP' })
      }
      const bytes = Buffer.from(content, 'utf8')
      let offset = 0
      while (offset < bytes.length) {
        const remaining = bytes.subarray(offset)
        const written: [number] = [0]
        checked(api, api.writeFile(handle, remaining, remaining.length, written, null), 'WriteFile', path)
        if (written[0] === 0) throw Object.assign(new Error('atomic-write: WriteFile made no progress'), { code: 'EIO' })
        offset += written[0]
      }
    },
    sync() { checked(api, api.flush(handle), 'FlushFileBuffers', path) },
    close() { checked(api, api.close(handle), 'CloseHandle', path) },
  }
}

/**
 * Create one empty staging directory, optionally with a protected private DACL.
 * @param path - unused random sibling pathname.
 * @param privateDirectory - whether the caller requested mode 0700.
 */
export async function createDirectoryWin32(path: string, privateDirectory: boolean): Promise<void> {
  const api = await win32()
  const create = (attributes: SecurityAttributes | null): void => {
    checked(api, api.createDirectory(toNamespacedPath(path), attributes), 'CreateDirectoryW', path)
  }
  if (privateDirectory) withPrivateDescriptor(api, true, create)
  else create(null)
}

/**
 * Publish a same-volume staged object with write-through; never copy across volumes.
 * Access and sharing denials receive at most 500 ms of retry delay without
 * changing permissions. Permanent failures still reject before publication.
 * @param source - closed, flushed staging path.
 * @param target - destination entry (a symlink itself, not its referent).
 * @param replace - whether an existing destination file may be replaced.
 */
export async function publishWin32(source: string, target: string, replace: boolean): Promise<void> {
  const api = await win32()
  const from = toNamespacedPath(source)
  const to = toNamespacedPath(target)
  for (let attempt = 0; ; attempt++) {
    if (api.move(from, to, 0x8 | (replace ? 0x1 : 0)) !== 0) return
    const error = nativeError(api, 'MoveFileExW', target)
    const delay = RENAME_RETRY_DELAYS_MS[attempt]
    if (![5, 32, 33].includes(error.win32Code) || delay === undefined) throw error
    await new Promise<void>(resolve => setTimeout(resolve, delay))
  }
}
