import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { privateAccessViolation } from '../src/private-access.ts'
import { fileSecurityWin32 } from '../src/win32.ts'

vi.mock('../src/win32.ts', () => ({ fileSecurityWin32: vi.fn() }))

const USER = 'S-1-5-21-11-22-33-1001'
const SYSTEM = 'S-1-5-18'
const ADMINISTRATORS = 'S-1-5-32-544'
const EVERYONE = 'S-1-1-0'
const PATH = 'C:\\state\\identity.key'
const ALLOWED = 0
const DENIED = 1

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const originalGetuid = Object.getOwnPropertyDescriptor(process, 'getuid')
function platform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { ...originalPlatform, value })
}
function processUid(value: number | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process, 'getuid')
  else Object.defineProperty(process, 'getuid', { configurable: true, writable: true, value: () => value })
}
afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  if (originalGetuid === undefined) Reflect.deleteProperty(process, 'getuid')
  else Object.defineProperty(process, 'getuid', originalGetuid)
})

/** Binary SID: revision 1, sub-authority count, 48-bit big-endian authority, little-endian sub-authorities. */
function sid(text: string): Buffer {
  const [, , authority, ...parts] = text.split('-')
  const out = Buffer.alloc(8 + parts.length * 4)
  out[0] = 1
  out[1] = parts.length
  out.writeUIntBE(Number(authority), 2, 6)
  parts.forEach((part, index) => out.writeUInt32LE(Number(part), 8 + index * 4))
  return out
}
function entry(type: number, principal: Buffer, mask = 0x001f01ff, flags = 0): Buffer {
  const out = Buffer.alloc(8 + principal.length)
  out[0] = type
  out[1] = flags
  out.writeUInt16LE(out.length, 2)
  out.writeUInt32LE(mask, 4)
  principal.copy(out, 8)
  return out
}
function acl(entries: Buffer[], revision = 2): Buffer {
  const header = Buffer.alloc(8)
  header[0] = revision
  const body = Buffer.concat(entries)
  header.writeUInt16LE(8 + body.length, 2)
  header.writeUInt16LE(entries.length, 4)
  return Buffer.concat([header, body])
}
/** Self-relative descriptor: 20-byte header, owner SID at offset 20, then the DACL. */
function descriptor(owner = sid(USER), dacl: Buffer | null = acl([entry(ALLOWED, sid(USER))]), control = 0x8004): Buffer {
  const header = Buffer.alloc(20)
  header[0] = 1
  header.writeUInt16LE(control, 2)
  header.writeUInt32LE(20, 4)
  header.writeUInt32LE(dacl === null ? 0 : 20 + owner.length, 16)
  return Buffer.concat([header, owner, dacl ?? Buffer.alloc(0)])
}
function edited(edit: (bytes: Buffer) => void, base = descriptor()): Buffer {
  const copy = Buffer.from(base)
  edit(copy)
  return copy
}

describe('Windows private access', () => {
  const read = vi.mocked(fileSecurityWin32)
  beforeEach(() => {
    platform('win32')
    read.mockReset()
  })
  async function violation(bytes: Buffer): Promise<string | undefined> {
    read.mockResolvedValueOnce({ descriptor: bytes, user: USER })
    return privateAccessViolation(PATH, { mode: 0o100666, uid: 0 }, { posixOwner: false })
  }

  it('reads the entry natively and accepts owners and allow entries of the process user, SYSTEM and Administrators', async () => {
    const everyone = sid(EVERYONE)
    const trusted = [sid(USER), sid(SYSTEM), sid(ADMINISTRATORS)]
    const entries = acl([...trusted.map(principal => entry(ALLOWED, principal)), entry(DENIED, everyone)])
    for (const owner of trusted) await expect(violation(descriptor(owner, entries))).resolves.toBeUndefined()
    expect(read).toHaveBeenCalledWith(PATH)
    await expect(violation(descriptor(sid(USER), acl([entry(ALLOWED, sid(USER))], 4)))).resolves.toBeUndefined()
    await expect(violation(descriptor(sid(USER), acl([])))).resolves.toBeUndefined()
  })

  it('names the principal and mask of every allow entry for another account, inherit-only included', async () => {
    await expect(violation(descriptor(sid(USER), acl([entry(ALLOWED, sid(USER)), entry(ALLOWED, sid(EVERYONE), 0x001200a9)]))))
      .resolves.toBe(`${PATH}: allow entry for S-1-1-0 with access mask 0x001200a9`)
    await expect(violation(descriptor(sid(USER), acl([entry(ALLOWED, sid('S-1-5-32-545'), 0x80000000, 0x0b)]))))
      .resolves.toBe(`${PATH}: allow entry for S-1-5-32-545 with access mask 0x80000000`)
    await expect(violation(descriptor(sid(USER), acl([entry(ALLOWED, sid('S-1-4294967296-7'), 1)]))))
      .resolves.toBe(`${PATH}: allow entry for S-1-0x000100000000-7 with access mask 0x00000001`)
  })

  it('rejects an untrusted owner, an absent or null DACL and unsupported entry types', async () => {
    await expect(violation(descriptor(sid(EVERYONE))))
      .resolves.toBe(`${PATH}: owner S-1-1-0 is not the process user, SYSTEM, or Administrators`)
    await expect(violation(descriptor(sid(USER), acl([]), 0x8000))).resolves.toBe(`${PATH}: no DACL, which grants every account full access`)
    await expect(violation(descriptor(sid(USER), null))).resolves.toBe(`${PATH}: no DACL, which grants every account full access`)
    await expect(violation(descriptor(sid(USER), acl([entry(9, sid(USER))])))).resolves.toBe(`${PATH}: unsupported access entry type 9`)
  })

  it('rejects every malformed descriptor field instead of reading past it', async () => {
    const valid = descriptor()
    const dacl = 20 + sid(USER).length
    const first = dacl + 8
    const cases: Array<[string, Buffer]> = [
      ['short header', valid.subarray(0, 19)],
      ['descriptor revision', edited((bytes) => { bytes[0] = 2 })],
      ['absolute descriptor', edited(bytes => bytes.writeUInt16LE(0x0004, 2))],
      ['owner offset inside the header', edited(bytes => bytes.writeUInt32LE(0, 4))],
      ['owner offset past the end', edited(bytes => bytes.writeUInt32LE(valid.length - 4, 4))],
      ['owner revision', edited((bytes) => { bytes[20] = 2 })],
      ['owner sub-authority limit', edited((bytes) => { bytes[21] = 16 })],
      ['owner sub-authorities past the end', descriptor(sid(USER), null).subarray(0, 20 + 8 + 4)],
      ['DACL offset inside the header', edited(bytes => bytes.writeUInt32LE(8, 16))],
      ['DACL header past the end', edited(bytes => bytes.writeUInt32LE(valid.length - 4, 16))],
      ['DACL revision', edited((bytes) => { bytes[dacl] = 3 })],
      ['DACL size below its header', edited(bytes => bytes.writeUInt16LE(4, dacl + 2))],
      ['DACL size past the end', edited(bytes => bytes.writeUInt16LE(valid.length, dacl + 2))],
      ['entry count past the DACL', edited(bytes => bytes.writeUInt16LE(2, dacl + 4))],
      ['entry size below its header', edited(bytes => bytes.writeUInt16LE(2, first + 2))],
      ['entry size past the DACL', edited(bytes => bytes.writeUInt16LE(64, first + 2))],
      ['entry principal past the entry', edited(bytes => bytes.writeUInt16LE(12, first + 2))],
    ]
    for (const [name, bytes] of cases) expect(await violation(bytes), name).toBe(`${PATH}: malformed security descriptor`)
  })

  it('rejects when the native read fails', async () => {
    const failure = Object.assign(new Error('fixture GetFileSecurityW failure'), { code: 'EACCES' })
    read.mockRejectedValueOnce(failure)
    await expect(privateAccessViolation(PATH, { mode: 0o100600, uid: 0 }, { posixOwner: true })).rejects.toBe(failure)
  })
})

describe('POSIX private access', () => {
  beforeEach(() => {
    platform('linux')
    processUid(1000)
    vi.mocked(fileSecurityWin32).mockReset()
  })

  it('rejects group or other mode bits and, when asked, an owner other than the process user', async () => {
    await expect(privateAccessViolation('/state/key', { mode: 0o100600, uid: 1000 }, { posixOwner: true })).resolves.toBeUndefined()
    await expect(privateAccessViolation('/state', { mode: 0o040700, uid: 1000 }, { posixOwner: true })).resolves.toBeUndefined()
    await expect(privateAccessViolation('/state/key', { mode: 0o100644, uid: 1000 }, { posixOwner: true }))
      .resolves.toBe('/state/key: mode 0644 grants group or other access')
    await expect(privateAccessViolation('/state/key', { mode: 0o100600, uid: 1001 }, { posixOwner: true }))
      .resolves.toBe('/state/key: owner uid 1001 is not the process user')
    await expect(privateAccessViolation('/state/key', { mode: 0o100600, uid: 1001 }, { posixOwner: false })).resolves.toBeUndefined()
    processUid(undefined)
    await expect(privateAccessViolation('/state/key', { mode: 0o100600, uid: 0 }, { posixOwner: true }))
      .resolves.toBe('/state/key: owner uid 0 is not the process user')
    expect(fileSecurityWin32).not.toHaveBeenCalled()
  })

  // The seven identity call sites replaced `!isKind || isSymlink || (platform !== 'win32' && <mode and owner>)` with a
  // type check followed by this function. On POSIX both forms must reject exactly the same entries.
  it('decides every mode, owner and entry type exactly as the inline identity checks did', async () => {
    const kinds = [
      { name: 'file', expect: 'file', isFile: true, isDirectory: false, isSymbolicLink: false },
      { name: 'directory', expect: 'directory', isFile: false, isDirectory: true, isSymbolicLink: false },
      { name: 'symlink to file', expect: 'file', isFile: true, isDirectory: false, isSymbolicLink: true },
      { name: 'directory where a file is expected', expect: 'file', isFile: false, isDirectory: true, isSymbolicLink: false },
      { name: 'file where a directory is expected', expect: 'directory', isFile: true, isDirectory: false, isSymbolicLink: false },
    ]
    const modes = [0o600, 0o700, 0o400, 0o000, 0o640, 0o604, 0o620, 0o602, 0o610, 0o601, 0o644, 0o660, 0o755, 0o777, 0o4700, 0o2600, 0o1700]
    let compared = 0
    for (const kind of kinds) {
      for (const mode of modes) {
        for (const uid of [1000, 1001]) {
          for (const posixOwner of [true, false]) {
            const info = { mode, uid }
            const wrongType = !(kind.expect === 'file' ? kind.isFile : kind.isDirectory) || kind.isSymbolicLink
            const inline = posixOwner
              ? wrongType || (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
              : wrongType || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
            const shared = wrongType || (await privateAccessViolation('/state/entry', info, { posixOwner })) !== undefined
            expect(shared, `${kind.name} mode ${mode.toString(8)} uid ${uid} posixOwner ${String(posixOwner)}`).toBe(inline)
            compared++
          }
        }
      }
    }
    expect(compared).toBe(kinds.length * modes.length * 4)
  })
})
