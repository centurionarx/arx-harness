/** Bounded raw HTTP body intake and native GitHub HMAC verification. */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** HTTP refusal whose message contains no request or secret data. */
export class WebhookHttpError extends Error {
  override readonly name = 'WebhookHttpError'
  constructor(readonly status: 400 | 401 | 405 | 413 | 415 | 429 | 503, message: string) { super(message) }
}

function contentLength(request: IncomingMessage): number | undefined {
  const value = request.headers['content-length']
  if (value === undefined) return undefined
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new WebhookHttpError(400, 'invalid Content-Length')
  const length = Number(value)
  if (!Number.isSafeInteger(length)) throw new WebhookHttpError(413, 'request body is too large')
  return length
}

/**
 * Read one exact raw body under a byte ceiling.
 * @param request - incoming request before any body parser consumes it.
 * @param maxBodyBytes - positive configured byte ceiling.
 * @returns the raw bytes used for HMAC verification.
 */
export async function readBoundedBody(request: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
  const declared = contentLength(request)
  if (declared !== undefined && declared > maxBodyBytes) {
    request.resume()
    throw new WebhookHttpError(413, 'request body is too large')
  }
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const raw of request) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as string)
      size += chunk.byteLength
      if (size > maxBodyBytes) {
        request.resume()
        throw new WebhookHttpError(413, 'request body is too large')
      }
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    if (error instanceof WebhookHttpError) throw error
    throw new WebhookHttpError(400, 'request body was aborted')
  }
  if (!request.complete) throw new WebhookHttpError(400, 'request body was aborted')
  return Buffer.concat(chunks, size)
}

/**
 * Compare a GitHub SHA-256 signature against the exact raw request bytes.
 * @param body - raw body bytes.
 * @param signature - `sha256=` request header.
 * @param secret - resolved shared secret.
 * @returns true only for a well-formed matching digest.
 */
export function verifyGitHubSignature(body: Buffer, signature: string, secret: string): boolean {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signature)
  const supplied = match === null ? Buffer.alloc(32) : Buffer.from(match[1] as string, 'hex')
  const expected = createHmac('sha256', secret).update(body).digest()
  const equal = timingSafeEqual(expected, supplied)
  return match !== null && equal
}
