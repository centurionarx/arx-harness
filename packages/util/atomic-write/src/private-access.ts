/**
 * Verification that only the process user can reach an existing file or
 * directory. POSIX reads the caller's lstat result; Windows reads the entry's
 * owner and DACL through GetFileSecurityW. Any read failure rejects.
 * @module @arx-ai/arx-atomic-write/private-access
 */

import type { Stats } from 'node:fs'
import { fileSecurityWin32 } from './win32.ts'

/** POSIX facts {@link privateAccessViolation} checks besides the group and other mode bits. */
export interface PrivateAccessOptions {
  /** Also require the POSIX owner to be the process user. Windows always checks the owner. */
  posixOwner: boolean
}

// Principals that already hold full control of every local file: the operating
// system and the local administrators. A Windows entry may name only these and
// the process user as owner or in an allow entry.
const SYSTEM = 'S-1-5-18'
const ADMINISTRATORS = 'S-1-5-32-544'

// winnt.h: SECURITY_DESCRIPTOR_RELATIVE and ACL header fields.
const SE_DACL_PRESENT = 0x0004
const SE_SELF_RELATIVE = 0x8000
const ACCESS_ALLOWED_ACE_TYPE = 0
const ACCESS_DENIED_ACE_TYPE = 1
const MALFORMED = 'malformed security descriptor'

/**
 * Report why an existing entry is reachable by a principal other than the
 * process user, or `undefined` when it is not. The caller has already rejected
 * symbolic links and wrong entry types from the same `lstat` result, because
 * the Windows read follows a final link.
 *
 * POSIX rejects any group or other mode bit and, with `posixOwner`, an owner
 * other than the process user. Windows rejects an owner other than the process
 * user, SYSTEM, or Administrators; a missing or null DACL; an allow entry, of
 * any mask or inheritance, for any other principal; and any entry type other
 * than access-allowed or access-denied. Deny entries are ignored. A malformed
 * descriptor rejects; a native read failure rejects the returned promise.
 *
 * On Windows the entry type comes from the caller's `lstat` and the access
 * from a second lookup of `path` that follows a final link. Replacing the
 * entry between the two requires write access to its parent directory, which
 * already allows replacing it between the check and the caller's later open.
 * @param path - the entry whose access is verified.
 * @param info - the caller's `lstat` result for `path`.
 * @param options - POSIX owner policy.
 * @returns the first violation, naming the principal and access mask of a rejected Windows entry.
 */
export async function privateAccessViolation(
  path: string,
  info: Pick<Stats, 'mode' | 'uid'>,
  options: PrivateAccessOptions,
): Promise<string | undefined> {
  if (process.platform !== 'win32') {
    if ((info.mode & 0o077) !== 0) return `${path}: mode ${(info.mode & 0o777).toString(8).padStart(4, '0')} grants group or other access`
    if (options.posixOwner && info.uid !== process.getuid?.()) return `${path}: owner uid ${info.uid} is not the process user`
    return undefined
  }
  const { descriptor, user } = await fileSecurityWin32(path)
  const violation = descriptorViolation(descriptor, new Set([user, SYSTEM, ADMINISTRATORS]))
  return violation === undefined ? undefined : `${path}: ${violation}`
}

function descriptorViolation(descriptor: Buffer, trusted: ReadonlySet<string>): string | undefined {
  if (descriptor.length < 20 || descriptor[0] !== 1) return MALFORMED
  const control = descriptor.readUInt16LE(2)
  if ((control & SE_SELF_RELATIVE) === 0) return MALFORMED
  const owner = sidAt(descriptor, descriptor.readUInt32LE(4), descriptor.length)
  if (owner === undefined) return MALFORMED
  if (!trusted.has(owner)) return `owner ${owner} is not the process user, SYSTEM, or Administrators`
  const dacl = descriptor.readUInt32LE(16)
  if ((control & SE_DACL_PRESENT) === 0 || dacl === 0) return 'no DACL, which grants every account full access'
  if (dacl < 20 || dacl + 8 > descriptor.length || (descriptor[dacl] !== 2 && descriptor[dacl] !== 4)) return MALFORMED
  const end = dacl + descriptor.readUInt16LE(dacl + 2)
  if (end < dacl + 8 || end > descriptor.length) return MALFORMED
  let offset = dacl + 8
  for (let index = descriptor.readUInt16LE(dacl + 4); index > 0; index--) {
    if (offset + 4 > end) return MALFORMED
    const type = descriptor.readUInt8(offset)
    const size = descriptor.readUInt16LE(offset + 2)
    if (size < 4 || offset + size > end) return MALFORMED
    if (type !== ACCESS_ALLOWED_ACE_TYPE && type !== ACCESS_DENIED_ACE_TYPE) return `unsupported access entry type ${type}`
    const principal = sidAt(descriptor, offset + 8, offset + size)
    if (principal === undefined) return MALFORMED
    if (type === ACCESS_ALLOWED_ACE_TYPE && !trusted.has(principal)) {
      const mask = descriptor.readUInt32LE(offset + 4).toString(16).padStart(8, '0')
      return `allow entry for ${principal} with access mask 0x${mask}`
    }
    offset += size
  }
  return undefined
}

/**
 * Decode the SID at `offset` in the string form ConvertSidToStringSidW
 * produces (an authority of 2^32 or more as twelve lowercase hex digits), or
 * `undefined` when it is not a revision-1 SID inside `limit`.
 */
function sidAt(buffer: Buffer, offset: number, limit: number): string | undefined {
  if (offset < 20 || offset + 8 > limit || buffer[offset] !== 1) return undefined
  const count = buffer.readUInt8(offset + 1)
  if (count > 15 || offset + 8 + count * 4 > limit) return undefined
  const authority = buffer.readUIntBE(offset + 2, 6)
  let text = 'S-1-' + (authority < 2 ** 32 ? String(authority) : '0x' + authority.toString(16).padStart(12, '0'))
  for (let index = 0; index < count; index++) text += '-' + String(buffer.readUInt32LE(offset + 8 + index * 4))
  return text
}
