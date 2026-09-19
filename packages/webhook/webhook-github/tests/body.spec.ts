import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { readBoundedBody, verifyGitHubSignature, WebhookHttpError } from '../src/body.ts'

function request(options: {
  readonly contentLength?: string
  readonly chunks?: readonly (Buffer | string)[]
  readonly complete?: boolean
  readonly failure?: Error
}) {
  const resume = vi.fn()
  const value = {
    headers: options.contentLength === undefined ? {} : { 'content-length': options.contentLength },
    complete: options.complete ?? true,
    resume,
    async * [Symbol.asyncIterator]() {
      for (const chunk of options.chunks ?? []) yield chunk
      if (options.failure !== undefined) throw options.failure
    },
  } as unknown as IncomingMessage
  return { request: value, resume }
}

describe('bounded raw webhook body intake', () => {
  it('accepts absent or exact Content-Length and both Buffer and string chunks', async () => {
    const absent = request({ chunks: [Buffer.from('ab'), 'cd'] })
    await expect(readBoundedBody(absent.request, 4)).resolves.toEqual(Buffer.from('abcd'))
    const declared = request({ contentLength: '0' })
    await expect(readBoundedBody(declared.request, 0)).resolves.toEqual(Buffer.alloc(0))
  })

  it.each(['-1', '01', 'wat'])('rejects invalid Content-Length %j', async (contentLength) => {
    await expect(readBoundedBody(request({ contentLength }).request, 10))
      .rejects.toMatchObject({ status: 400, message: 'invalid Content-Length' })
  })

  it('rejects unsafe and over-limit declared lengths before reading', async () => {
    await expect(readBoundedBody(request({ contentLength: '9007199254740992' }).request, Number.MAX_SAFE_INTEGER))
      .rejects.toMatchObject({ status: 413 })
    const oversized = request({ contentLength: '5', chunks: ['never read'] })
    await expect(readBoundedBody(oversized.request, 4)).rejects.toMatchObject({ status: 413 })
    expect(oversized.resume).toHaveBeenCalledOnce()
  })

  it('stops an undeclared streaming body when the accumulated bytes exceed the ceiling', async () => {
    const oversized = request({ chunks: [Buffer.from('abc'), Buffer.from('de')] })
    await expect(readBoundedBody(oversized.request, 4)).rejects.toBeInstanceOf(WebhookHttpError)
    expect(oversized.resume).toHaveBeenCalledOnce()
  })

  it('normalizes stream failures and incomplete messages to an aborted-body refusal', async () => {
    await expect(readBoundedBody(request({ failure: new Error('socket detail') }).request, 10))
      .rejects.toMatchObject({ status: 400, message: 'request body was aborted' })
    await expect(readBoundedBody(request({ complete: false, chunks: ['ok'] }).request, 10))
      .rejects.toMatchObject({ status: 400, message: 'request body was aborted' })
  })
})

describe('GitHub HMAC comparison', () => {
  const body = Buffer.from('payload')
  const digest = 'sha256=b82fcb791acec57859b989b430a826488ce2e479fdf92326bd0a2e8375a42ba4'

  it('accepts the exact digest case-insensitively and rejects a different valid digest', () => {
    expect(verifyGitHubSignature(body, digest.toUpperCase(), 'secret')).toBe(true)
    expect(verifyGitHubSignature(body, `sha256=${'0'.repeat(64)}`, 'secret')).toBe(false)
  })

  it.each(['', 'sha1=bad', 'sha256=abc'])('performs a fixed-width comparison for malformed signature %j', (signature) => {
    expect(verifyGitHubSignature(body, signature, 'secret')).toBe(false)
  })
})
