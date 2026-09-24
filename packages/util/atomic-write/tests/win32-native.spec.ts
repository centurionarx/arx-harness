import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, toNamespacedPath } from 'node:path'
import { expect, it } from 'vitest'
import { writeFileAtomic } from '../src/index.ts'

/** Query owner and DACL independently from the production creation bindings. */
async function securityDescriptor(path: string): Promise<string> {
  const koffi = (await import('koffi')).default
  const security = koffi.load('advapi32.dll')
  const kernel = koffi.load('kernel32.dll')
  const query = security.func('int __stdcall GetFileSecurityW(const char16_t *path, uint32_t flags, void *descriptor, uint32_t size, _Out_ uint32_t *needed)') as (path: string, flags: number, buffer: Buffer | null, size: number, needed: [number]) => number
  const toString = security.func('int __stdcall ConvertSecurityDescriptorToStringSecurityDescriptorW(const void *descriptor, uint32_t revision, uint32_t flags, _Out_ void **text, _Out_ uint32_t *length)') as (buffer: Buffer, revision: number, flags: number, text: [bigint | null], length: [number]) => number
  const free = kernel.func('void * __stdcall LocalFree(void *pointer)') as (pointer: bigint | null) => bigint | null
  const size: [number] = [0]
  query(toNamespacedPath(path), 5, null, 0, size)
  expect(size[0]).toBeGreaterThan(0)
  const descriptor = Buffer.alloc(size[0])
  expect(query(toNamespacedPath(path), 5, descriptor, size[0], size)).toBe(1)
  const text: [bigint | null] = [null]
  const length: [number] = [0]
  expect(toString(descriptor, 1, 5, text, length)).toBe(1)
  try {
    return Buffer.from(koffi.view(text[0], (length[0] - 1) * 2)).toString('utf16le')
  } finally {
    expect(free(text[0])).toBeNull()
  }
}

it.runIf(process.platform === 'win32')('enforces native owner-only DACLs on replacement and new parents, without hardening existing parents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arx-private-dacl-'))
  try {
    const initial = await securityDescriptor(root)
    const target = join(root, 'private', 'nested', 'settings.yaml')
    await writeFileAtomic(target, 'first', { mode: 0o600, dirMode: 0o700 })
    expect(await readFile(target, 'utf8')).toBe('first')
    const file = await securityDescriptor(target)
    const owner = /^O:(.+?)D:/.exec(file)![1]!
    expect(file).toBe(`O:${owner}D:P(A;;FA;;;${owner})`)
    for (const directory of [join(root, 'private'), join(root, 'private', 'nested')]) {
      expect(await securityDescriptor(directory)).toBe(`O:${owner}D:P(A;OICI;FA;;;${owner})`)
    }
    expect(await securityDescriptor(root)).toBe(initial)
    const wider = join(root, 'existing.yaml')
    await writeFile(wider, 'old')
    await writeFileAtomic(wider, 'replacement', { mode: 0o600, dirMode: 0o700 })
    expect(await readFile(wider, 'utf8')).toBe('replacement')
    expect(await securityDescriptor(wider)).toBe(file)
    expect(await securityDescriptor(root)).toBe(initial)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it.runIf(process.platform === 'win32')('waits out a short-lived reader that denies delete sharing without replacing early', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arx-private-sharing-'))
  const target = join(root, 'credentials.yaml')
  const koffi = (await import('koffi')).default
  const kernel = koffi.load('kernel32.dll')
  const open = kernel.func('void * __stdcall CreateFileW(const char16_t *path, uint32_t access, uint32_t sharing, void *attributes, uint32_t creation, uint32_t flags, void *template)') as (path: string, access: number, sharing: number, attributes: null, creation: number, flags: number, template: null) => bigint
  const close = kernel.func('int __stdcall CloseHandle(void *handle)') as (handle: bigint) => number
  let reader: bigint | undefined
  try {
    await writeFileAtomic(target, 'old', { mode: 0o600 })
    reader = open(toNamespacedPath(target), 0x80000000, 3, null, 3, 0x80, null)
    expect(reader).not.toBe(0xffffffffffffffffn)
    const result = writeFileAtomic(target, 'replacement', { mode: 0o600 }).then(
      () => ({ ok: true }), (error: unknown) => ({ ok: false, error }),
    )
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(await readFile(target, 'utf8')).toBe('old')
    expect(close(reader)).toBe(1)
    reader = undefined
    expect(await result).toEqual({ ok: true })
    expect(await readFile(target, 'utf8')).toBe('replacement')
  } finally {
    if (reader !== undefined) close(reader)
    await rm(root, { recursive: true, force: true })
  }
})
