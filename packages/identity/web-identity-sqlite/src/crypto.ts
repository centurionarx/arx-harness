/** Native password and token cryptography; no ambient environment reads. */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, basename } from 'node:path'
import { privateAccessViolation } from '@arx-ai/arx-atomic-write'
import { identityFailure, WebIdentityError } from '@arx-ai/arx-web-identity'
import type { IdentityDelivery } from '@arx-ai/arx-web-identity'
const N = 131072
let hashing = 0
let maximumPending = 16
interface HashWaiter {
  reserve: () => void
  abort: () => void
}
const waiters: HashWaiter[] = []
/**
 * Set the bounded pending password-work capacity; active hashing remains limited to two.
 * @param limit - Pending capacity from 0 through 64.
 */
export function configureHashQueueLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 64)
    identityFailure('AUTH_CONFIGURATION', 503, 'Bounded password queue required')
  maximumPending = limit
}
function aborted(): never { throw new WebIdentityError('AUTH_ABORTED', 499, 'Identity request cancelled') }
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted === true)
  aborted() }
/**
 * Enforce code-point and UTF-8 byte limits without normalization or truncation.
 * @param value - Recipient-selected password.
 */
export function validatePassword(value: string): void {
  const length = Array.from(value).length
  if (length < 15 || length > 256 || Buffer.byteLength(value) > 1024) {
    identityFailure('PASSWORD_POLICY', 400, 'Use 15 to 256 characters and at most 1024 UTF-8 bytes')
  }
}
async function derive(password: string, salt: Buffer, signal?: AbortSignal): Promise<Buffer> {
  checkAbort(signal)
  if (hashing >= 2) {
    if (waiters.length >= maximumPending)
      identityFailure('AUTH_RATE_LIMITED', 429, 'Try again later')
    await new Promise<void>((resolve, reject) => {
      const waiter: HashWaiter = { reserve: () => { signal?.removeEventListener('abort', waiter.abort); resolve() },
        abort: () => {
          const index = waiters.indexOf(waiter)
          if (index >= 0)
            waiters.splice(index, 1)
          signal?.removeEventListener('abort', waiter.abort)
          reject(new WebIdentityError('AUTH_ABORTED', 499, 'Identity request cancelled'))
        } }
      waiters.push(waiter)
      signal?.addEventListener('abort', waiter.abort, { once: true })
    })
  }
  else
    hashing++
  try {
    checkAbort(signal)
    const value = await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 32, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, result) => { if (error === null) {
        resolve(result)
      }
      else {
        reject(error)
      } })
    })
    checkAbort(signal)
    return value
  }
  finally {
    const next = waiters.shift()
    if (next === undefined)
      hashing--
    else
      next.reserve()
  }
}
/**
 * Derive a native scrypt verifier with fixed cost and a random salt.
 * @param password - Password satisfying the native policy.
 * @param signal - Cancels bounded hashing admission.
 * @returns Serialized salted verifier, never the plaintext password.
 */
export async function hashPassword(password: string, signal?: AbortSignal): Promise<string> {
  validatePassword(password)
  const salt = randomBytes(16)
  const key = await derive(password, salt, signal)
  return ['scrypt', N, 8, 1, salt.toString('base64url'), key.toString('base64url')].join('$')
}
/**
 * Verify a native scrypt record using bounded work and constant-time output comparison.
 * @param password - Submitted password.
 * @param encoded - Serialized verifier or the dummy account verifier.
 * @param signal - Cancels bounded hashing admission.
 * @returns Whether the supported verifier matches.
 */
export async function verifyPassword(password: string, encoded: string, signal?: AbortSignal): Promise<boolean> {
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== String(N) || parts[2] !== '8' || parts[3] !== '1')
    return false
  const salt = Buffer.from((parts[4] as string), 'base64url')
  const expected = Buffer.from((parts[5] as string), 'base64url')
  if (salt.length !== 16 || expected.length !== 32 || Buffer.byteLength(password) > 1024)
    return false
  const actual = await derive(password, salt, signal)
  return timingSafeEqual(actual, expected)
}
/**
 * Generate a cryptographically random 256-bit opaque token.
 * @returns Base64url token text for private cookie or link transport.
 */
export function newToken(): string { return randomBytes(32).toString('base64url') }
/**
 * Hash private token text before durable identity storage.
 * @param value - Purpose-bound token input.
 * @returns Hex SHA-256 digest.
 */
export function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
/**
 * Derive a session-bound browser CSRF verifier.
 * @param key - Private identity key outside DB backups.
 * @param sessionId - Authentication session identity.
 * @returns Base64url HMAC verifier.
 */
export function csrf(key: Buffer, sessionId: string): string {
  return createHmac('sha256', key).update('arx-csrf-v1:' + sessionId).digest('base64url')
}
/**
 * Compare equal-length verifier strings without content-dependent comparison.
 * @param a - Expected verifier.
 * @param b - Submitted verifier.
 * @returns Whether both byte strings match.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
/**
 * Load the explicit private identity key without ambient environment reads.
 * @param path - Absolute protected key file.
 * @returns Validated 32-byte private key.
 */
export async function readPrivateKey(path: string): Promise<Buffer> {
  if (!isAbsolute(path) || basename(path) === '.env')
    identityFailure('AUTH_CONFIGURATION', 503, 'Private identity key required')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink())
    identityFailure('AUTH_CONFIGURATION', 503, 'Private identity key required')
  const violation = await privateAccessViolation(path, info, { posixOwner: true })
  if (violation !== undefined)
    identityFailure('AUTH_CONFIGURATION', 503, 'Private identity key required', violation)
  const key = await readFile(path)
  if (key.length !== 32)
    identityFailure('AUTH_CONFIGURATION', 503, 'Private identity key required')
  return key
}
/**
 * Encrypt a private outbox envelope with a random nonce and operation-ID AAD.
 * @param key - Private 32-byte identity key.
 * @param mail - Registered-recipient invitation or reset envelope.
 * @returns Encoded AES-256-GCM payload.
 */
export function encryptDelivery(key: Buffer, mail: IdentityDelivery): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(mail.operationId))
  const body = Buffer.concat([cipher.update(JSON.stringify(mail), 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64')
}
/**
 * Authenticate and decode an encrypted outbox envelope.
 * @param key - Private identity key.
 * @param operationId - AAD binding of this outbox operation.
 * @param encoded - Stored AES-256-GCM payload.
 * @returns Private outbound envelope after authentication.
 */
export function decryptDelivery(key: Buffer, operationId: string, encoded: string): IdentityDelivery {
  const bytes = Buffer.from(encoded, 'base64')
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
  cipher.setAAD(Buffer.from(operationId))
  cipher.setAuthTag(bytes.subarray(12, 28))
  const plain = Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()])
  return JSON.parse(plain.toString('utf8')) as IdentityDelivery
}
