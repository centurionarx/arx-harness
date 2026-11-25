/**
 * ACL failure-path tests with stub binding tables (the failure-paths.spec.ts
 * pattern): every checked Win32 call in the lock, read-merge-write, and
 * grant-skip sequence has a failing counterpart, and each failure closes the
 * handles it created before throwing. The exact-ACE skip and the DACL-walk
 * defenses are driven through crafted in-memory ACL/SID buffers. Pure
 * stubs — no real Win32 calls, so these run on every platform; the
 * real-FFI round-trip lives in acl.spec.ts (win32 only).
 */

import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import koffi from 'koffi'

import { buildLowLabelSacl, grantWrite, revokeWrite, withPathLock } from '../src/acl.ts'
import { allocBytes, ptrAddress } from '../src/ffi.ts'
import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
import { Win32Error } from '../src/errors.ts'
import * as abi from '../src/win32-abi.ts'

const PVOID = koffi.pointer('void')

/** The stub the grant/revoke happy path needs; every call succeeds until a field is overridden per test. */
function aclApi(overrides: Partial<Win32Bindings> = {}): Win32Bindings {
  return {
    getTempPathW: vi.fn((_length: number, buffer: Buffer) => {
      const temp = tmpdir().replace(/[\\/]$/u, '')
      buffer.write(temp, 'utf16le')
      return temp.length
    }),
    createFileW: vi.fn(() => 7n),
    lockFileEx: vi.fn(() => 1),
    unlockFileEx: vi.fn(() => 1),
    closeHandle: vi.fn(() => 1),
    getNamedSecurityInfoW: vi.fn((
      _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
      dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
    ) => {
      koffi.encode(dacl, PVOID, 0n) // no explicit DACL: the merge builds one
      koffi.encode(descriptor, PVOID, 0n)
      return 0
    }),
    setEntriesInAclW: vi.fn((_count: unknown, _entries: unknown, _old: unknown, newAcl: NativePtr) => {
      koffi.encode(newAcl, PVOID, 9n)
      return 0
    }),
    setNamedSecurityInfoW: vi.fn(() => 0),
    localFree: vi.fn(() => 0n as NativePtr),
    getLastError: vi.fn(() => 5),
    formatMessageW: vi.fn(() => 0),
    ...overrides,
  } as unknown as Win32Bindings
}

/** One SID allocation: revision@0, subAuthorityCount@1, identifierAuthority@2 (6 bytes), subauthorities@8. */
function craftSid(revision: number, count: number, authority: number[] = [0, 0, 0, 0, 0, 5]): NativePtr {
  const sid = allocBytes(8)
  koffi.encode(sid, 'uint8', revision)
  koffi.encode(sid, 1, 'uint8', count)
  authority.forEach((byte, index) => {
    koffi.encode(sid, 2 + index, 'uint8', byte)
  })
  return sid
}

/**
 * One in-memory ACL carrying the exact grant ACE the skip checks for:
 * header (AclRevision@0, AclSize@2, AceCount@4) then one ACCESS_ALLOWED_ACE
 * (AceType@0, AceFlags@1, AceSize@2, Mask@4, inline SID@8). `match` selects
 * whether the inline SID bytes equal `sid`.
 */
function craftAclWithGrant(sid: NativePtr, match: boolean): NativePtr {
  const acl = allocBytes(32)
  koffi.encode(acl, 'uint8', 2) // AclRevision
  koffi.encode(acl, 2, 'uint16', 24) // AclSize: 8-byte header + one 16-byte ACE
  koffi.encode(acl, 4, 'uint16', 1) // AceCount
  const ace = 8
  koffi.encode(acl, ace + 0, 'uint8', abi.ACCESS_ALLOWED_ACE_TYPE)
  koffi.encode(acl, ace + 1, 'uint8', abi.SUB_CONTAINERS_AND_OBJECTS_INHERIT)
  koffi.encode(acl, ace + 2, 'uint16', 16) // AceSize: header + mask + inline 8-byte SID
  koffi.encode(acl, ace + 4, 'uint32', abi.GRANT_MASK)
  const inlineSid = ace + 8
  for (let offset = 0; offset < 8; offset++) {
    koffi.encode(acl, inlineSid + offset, 'uint8', match
      ? koffi.decode(sid, offset, 'uint8') as number
      : offset === 0 ? 9 : 0)
  }
  return acl
}

/**
 * One in-memory Low label ACL as buildLowLabelSacl writes it; `mutate`
 * rewrites single bytes so a test can break exactly one field.
 */
function craftLowLabelAcl(mutate: (bytes: Buffer) => void = () => {}): NativePtr {
  const bytes = buildLowLabelSacl()
  mutate(bytes)
  const acl = allocBytes(bytes.length)
  bytes.forEach((byte, index) => {
    koffi.encode(acl, index, 'uint8', byte)
  })
  return acl
}

/** A GetNamedSecurityInfoW stub that hands back the given DACL, label ACL, and descriptor addresses. */
function readsSecurity(dacl: bigint, label: bigint, descriptor: bigint): Win32Bindings['getNamedSecurityInfoW'] {
  return vi.fn((
    _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
    daclSlot: NativePtr, saclSlot: NativePtr, descriptorSlot: NativePtr,
  ) => {
    koffi.encode(daclSlot, PVOID, dacl)
    koffi.encode(saclSlot, PVOID, label)
    koffi.encode(descriptorSlot, PVOID, descriptor)
    return 0
  })
}

describe('withPathLock failure paths', () => {
  it('fails closed when CreateFileW returns an invalid handle', () => {
    const api = aclApi({ createFileW: vi.fn(() => 0n as NativePtr) })
    let caught: unknown
    try {
      withPathLock(api, 'C:\\locked', () => {})
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('CreateFileW')
  })

  it('closes the handle and reports when LockFileEx fails', () => {
    const closeHandle = vi.fn(() => 1)
    const api = aclApi({ lockFileEx: vi.fn(() => 0), closeHandle })
    let caught: unknown
    try {
      withPathLock(api, 'C:\\locked', () => {})
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('LockFileEx')
    expect(closeHandle).toHaveBeenCalledWith(7n)
  })

  it('closes the handle and reports when UnlockFileEx fails', () => {
    const closeHandle = vi.fn(() => 1)
    const api = aclApi({ unlockFileEx: vi.fn(() => 0), closeHandle })
    let caught: unknown
    try {
      withPathLock(api, 'C:\\locked', () => {})
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('UnlockFileEx')
    expect(closeHandle).toHaveBeenCalledWith(7n)
  })

  it('reports a failed CloseHandle after a successful action', () => {
    const api = aclApi({ closeHandle: vi.fn(() => 0) })
    let caught: unknown
    try {
      withPathLock(api, 'C:\\locked', () => {})
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('CloseHandle')
  })
})

describe('mergeAndApply failure paths', () => {
  it('reports a SetEntriesInAclW failure when the directory carries no descriptor to free', () => {
    const api = aclApi({ setEntriesInAclW: vi.fn(() => 5) }) // default descriptor: none
    const sid = craftSid(1, 0)
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetEntriesInAclW')
  })

  it('reports a NULL merged ACL when there is no descriptor to free', () => {
    const api = aclApi({ setEntriesInAclW: vi.fn(() => 0) }) // no out slot write, no descriptor
    const sid = craftSid(1, 0)
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetEntriesInAclW')
  })

  it('frees the descriptor and reports when SetEntriesInAclW fails', () => {
    const localFree = vi.fn(() => 0n as NativePtr)
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, 0n)
        koffi.encode(descriptor, PVOID, 6n) // an existing explicit DACL
        return 0
      }),
      setEntriesInAclW: vi.fn(() => 5),
      localFree,
    })
    const sid = craftSid(1, 0)
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetEntriesInAclW')
    expect(localFree).toHaveBeenCalledWith(6n)
  })

  it('frees the descriptor and reports a NULL merged ACL', () => {
    const localFree = vi.fn(() => 0n as NativePtr)
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, 0n)
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      setEntriesInAclW: vi.fn(() => 0), // success without writing the out slot
      localFree,
    })
    const sid = craftSid(1, 0)
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetEntriesInAclW')
    expect(localFree).toHaveBeenCalledWith(6n)
  })

  it('frees the merged ACL and reports when SetNamedSecurityInfoW fails', () => {
    const localFree = vi.fn(() => 0n as NativePtr)
    const api = aclApi({ setNamedSecurityInfoW: vi.fn(() => 5), localFree })
    const sid = craftSid(1, 0)
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetNamedSecurityInfoW')
    expect((caught as Win32Error).message).toContain('requires WRITE_DAC and WRITE_OWNER')
    expect(localFree).toHaveBeenCalledWith(9n)
  })

  it('a failed revoke apply names only the DACL edit (no label, so no WRITE_OWNER hint)', () => {
    const sid = craftSid(1, 0)
    const api = aclApi({
      getNamedSecurityInfoW: readsSecurity(ptrAddress(craftAclWithGrant(sid, true)), 0n, 6n),
      setNamedSecurityInfoW: vi.fn(() => 5),
    })
    let caught: unknown
    try {
      revokeWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('SetNamedSecurityInfoW')
    expect((caught as Win32Error).message).not.toContain('WRITE_OWNER')
  })

  it('reports a failed descriptor LocalFree after a successful apply', () => {
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, 0n)
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      localFree: vi.fn(() => 1n as NativePtr), // both frees "fail"; the first is checked
    })
    const sid = craftSid(1, 0)
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('LocalFree')
  })

  it('reports a failed merged-ACL LocalFree after a successful apply', () => {
    // No existing descriptor (the default stub): the merge's only LocalFree
    // is the merged ACL's, which "fails" and is checked after the apply.
    const api = aclApi({ localFree: vi.fn(() => 1n as NativePtr) })
    const sid = craftSid(1, 0)
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('LocalFree')
  })
})

describe('the exact-ACE skip and DACL-walk defenses', () => {
  it('grantWrite skips the apply when the standing exact ACE and Low label match (descriptor freed, nothing merged)', () => {
    const sid = craftSid(1, 0)
    const localFree = vi.fn(() => 0n as NativePtr)
    const setNamedSecurityInfoW = vi.fn(() => 0)
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, sacl: NativePtr, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, ptrAddress(craftAclWithGrant(sid, true)))
        koffi.encode(sacl, PVOID, ptrAddress(craftLowLabelAcl()))
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      localFree,
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).not.toHaveBeenCalled()
    expect(localFree).toHaveBeenCalledWith(6n)
  })

  it('grantWrite skips the apply without freeing when the exact ACE and label stand but no descriptor owns it', () => {
    const sid = craftSid(1, 0)
    const localFree = vi.fn(() => 0n as NativePtr)
    const setNamedSecurityInfoW = vi.fn(() => 0)
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, sacl: NativePtr, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, ptrAddress(craftAclWithGrant(sid, true)))
        koffi.encode(sacl, PVOID, ptrAddress(craftLowLabelAcl()))
        koffi.encode(descriptor, PVOID, 0n) // the read "returned" a bare ACL with no descriptor
        return 0
      }),
      localFree,
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).not.toHaveBeenCalled()
    expect(localFree).not.toHaveBeenCalled()
  })

  it('grantWrite reports a failed descriptor LocalFree on the exact-ACE skip path', () => {
    const sid = craftSid(1, 0)
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, sacl: NativePtr, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, ptrAddress(craftAclWithGrant(sid, true)))
        koffi.encode(sacl, PVOID, ptrAddress(craftLowLabelAcl()))
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      localFree: vi.fn(() => 1n as NativePtr),
    })
    let caught: unknown
    try {
      grantWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('LocalFree')
  })

  it('falls back to the merge path when the standing ACE names a different SID', () => {
    const sid = craftSid(1, 0)
    const setNamedSecurityInfoW = vi.fn(() => 0)
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, ptrAddress(craftAclWithGrant(sid, false)))
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).toHaveBeenCalledTimes(1)
  })

  it('treats an implausibly small ACL size as no exact grant', () => {
    const sid = craftSid(1, 0)
    const acl = allocBytes(32)
    koffi.encode(acl, 'uint8', 2)
    koffi.encode(acl, 2, 'uint16', 4) // smaller than the 8-byte ACL header
    koffi.encode(acl, 4, 'uint16', 1)
    const setNamedSecurityInfoW = vi.fn(() => 0)
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, ptrAddress(acl))
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).toHaveBeenCalledTimes(1)
  })

  it('treats an ACE that would overrun the ACL as no exact grant', () => {
    const sid = craftSid(1, 0)
    const acl = allocBytes(32)
    koffi.encode(acl, 'uint8', 2)
    koffi.encode(acl, 2, 'uint16', 8) // header only: no room for any ACE
    koffi.encode(acl, 4, 'uint16', 1)
    koffi.encode(acl, 10, 'uint16', 100) // the walk reads a lying ACE size
    const setNamedSecurityInfoW = vi.fn(() => 0)
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, ptrAddress(acl))
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).toHaveBeenCalledTimes(1)
  })
})

describe('the Low label: applied with the grant, skipped only when exact', () => {
  it('buildLowLabelSacl writes one inheritable NO_WRITE_UP label ACE for S-1-16-4096', () => {
    expect(buildLowLabelSacl().toString('hex')).toBe('02001c0001000000' + '1103140001000000' + '010100000000001000100000')
  })

  it('grantWrite reads the DACL and label, then applies both in one call', () => {
    const getNamedSecurityInfoW = readsSecurity(0n, 0n, 0n)
    const setNamedSecurityInfoW = vi.fn(() => 0)
    const api = aclApi({ getNamedSecurityInfoW, setNamedSecurityInfoW })
    grantWrite(api, 'C:\\granted', craftSid(1, 0))
    expect(getNamedSecurityInfoW).toHaveBeenCalledWith(
      'C:\\granted', abi.SE_FILE_OBJECT, abi.DACL_SECURITY_INFORMATION | abi.LABEL_SECURITY_INFORMATION,
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    )
    expect(setNamedSecurityInfoW).toHaveBeenCalledTimes(1)
    expect(setNamedSecurityInfoW).toHaveBeenCalledWith(
      'C:\\granted', abi.SE_FILE_OBJECT, abi.DACL_SECURITY_INFORMATION | abi.LABEL_SECURITY_INFORMATION,
      null, null, 9n, buildLowLabelSacl(),
    )
  })

  it('a standing exact ACE without the label (a grant made before the label existed) takes one apply', () => {
    const sid = craftSid(1, 0)
    const setNamedSecurityInfoW = vi.fn(() => 0)
    const api = aclApi({
      getNamedSecurityInfoW: readsSecurity(ptrAddress(craftAclWithGrant(sid, true)), 0n, 6n),
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).toHaveBeenCalledTimes(1)
  })

  it('skips a non-matching label ACE and matches the exact one after it', () => {
    const sid = craftSid(1, 0)
    const exact = buildLowLabelSacl()
    const ace = exact.subarray(8)
    const medium = Buffer.from(ace)
    medium.writeUInt8(0x20, 8 + 9) // S-1-16-8192: the Medium level
    const twoAces = Buffer.concat([exact.subarray(0, 8), medium, ace])
    twoAces.writeUInt16LE(twoAces.length, 2)
    twoAces.writeUInt16LE(2, 4)
    const label = allocBytes(twoAces.length)
    twoAces.forEach((byte, index) => {
      koffi.encode(label, index, 'uint8', byte)
    })
    const setNamedSecurityInfoW = vi.fn(() => 0)
    const api = aclApi({
      getNamedSecurityInfoW: readsSecurity(ptrAddress(craftAclWithGrant(sid, true)), ptrAddress(label), 6n),
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).not.toHaveBeenCalled()
  })

  it.each([
    ['an implausibly small label ACL', (bytes: Buffer) => { bytes.writeUInt16LE(4, 2) }],
    ['a label ACE that would overrun the ACL', (bytes: Buffer) => { bytes.writeUInt16LE(200, 10) }],
    ['a label ACE header that is too short', (bytes: Buffer) => { bytes.writeUInt16LE(4, 10) }],
    ['a different ACE type', (bytes: Buffer) => { bytes.writeUInt8(abi.ACCESS_ALLOWED_ACE_TYPE, 8) }],
    ['a label that does not inherit', (bytes: Buffer) => { bytes.writeUInt8(0, 9) }],
    ['a different label policy', (bytes: Buffer) => { bytes.writeUInt32LE(0x3, 12) }],
    ['a label ACE of another size', (bytes: Buffer) => { bytes.writeUInt16LE(16, 10) }],
    ['a different integrity level', (bytes: Buffer) => { bytes.writeUInt8(0x20, 25) }],
  ])('re-applies on %s', (_name, mutate) => {
    const sid = craftSid(1, 0)
    const setNamedSecurityInfoW = vi.fn(() => 0)
    const api = aclApi({
      getNamedSecurityInfoW: readsSecurity(ptrAddress(craftAclWithGrant(sid, true)), ptrAddress(craftLowLabelAcl(mutate)), 6n),
      setNamedSecurityInfoW,
    })
    grantWrite(api, 'C:\\granted', sid)
    expect(setNamedSecurityInfoW).toHaveBeenCalledTimes(1)
  })

  it('revokeWrite reads and rewrites the DACL only, leaving the label untouched', () => {
    const sid = craftSid(1, 0)
    const getNamedSecurityInfoW = readsSecurity(ptrAddress(craftAclWithGrant(sid, true)), 0n, 6n)
    const setNamedSecurityInfoW = vi.fn(() => 0)
    const api = aclApi({ getNamedSecurityInfoW, setNamedSecurityInfoW })
    expect(revokeWrite(api, 'C:\\granted', sid)).toBe(true)
    expect(getNamedSecurityInfoW).toHaveBeenCalledWith(
      'C:\\granted', abi.SE_FILE_OBJECT, abi.DACL_SECURITY_INFORMATION,
      expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    )
    expect(setNamedSecurityInfoW).toHaveBeenCalledWith('C:\\granted', abi.SE_FILE_OBJECT, abi.DACL_SECURITY_INFORMATION, null, null, 9n, null)
  })
})

describe('revokeWrite no-DACL path', () => {
  it('reports nothing to revoke when the read yields neither DACL nor descriptor', () => {
    // The default stub encodes a NULL DACL and a NULL descriptor.
    const api = aclApi()
    const sid = craftSid(1, 0)
    expect(revokeWrite(api, 'C:\\granted', sid)).toBe(false)
  })

  it('frees a descriptor that carries no DACL and reports nothing to revoke', () => {
    const localFree = vi.fn(() => 0n as NativePtr)
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, 0n)
        koffi.encode(descriptor, PVOID, 6n) // descriptor WITHOUT a DACL
        return 0
      }),
      localFree,
    })
    const sid = craftSid(1, 0)
    expect(revokeWrite(api, 'C:\\granted', sid)).toBe(false)
    expect(localFree).toHaveBeenCalledWith(6n)
  })

  it('reports a failed descriptor LocalFree on the no-DACL path', () => {
    const api = aclApi({
      getNamedSecurityInfoW: vi.fn((
        _path: unknown, _type: unknown, _info: unknown, _owner: unknown, _group: unknown,
        dacl: NativePtr, _sacl: unknown, descriptor: NativePtr,
      ) => {
        koffi.encode(dacl, PVOID, 0n)
        koffi.encode(descriptor, PVOID, 6n)
        return 0
      }),
      localFree: vi.fn(() => 1n as NativePtr),
    })
    const sid = craftSid(1, 0)
    let caught: unknown
    try {
      revokeWrite(api, 'C:\\granted', sid)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('LocalFree')
  })
})
