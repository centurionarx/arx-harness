/** Authorization wire admits only registered-key syntax and caller-owned prompt capabilities. */
import { describe, expect, it } from 'vitest'
import {
  authorizationBeginRequestSchema, authorizationDescribeValueSchema, authorizationPollValueSchema,
  authorizationSubmitRequestSchema,
} from '../src/api/authorization.schema.ts'

const id = '123e4567-e89b-42d3-a456-426614174000'
describe('authorization wire schemas', () => {
  it('accepts credential key grammar and rejects malformed routes', () => {
    expect(authorizationBeginRequestSchema.parse({ key: 'llm-pi-ai/openai-codex', method: 'oauth' })).toEqual({ key: 'llm-pi-ai/openai-codex', method: 'oauth' })
    expect(authorizationBeginRequestSchema.safeParse({ key: 'owner-/route--name' }).success).toBe(true)
    for (const key of ['not-scoped', '../secret', 'Owner/model', 'a/b/c']) {
      expect(authorizationBeginRequestSchema.safeParse({ key }).success).toBe(false)
    }
  })
  it('requires both private attempt and prompt capabilities for submitted answers', () => {
    expect(authorizationSubmitRequestSchema.parse({ attemptId: id, promptId: id, answer: 'transient' })).toEqual({ attemptId: id, promptId: id, answer: 'transient' })
    expect(authorizationSubmitRequestSchema.safeParse({ attemptId: id, answer: 'stale' }).success).toBe(false)
    expect(authorizationSubmitRequestSchema.safeParse({ attemptId: 'guess', promptId: id, answer: 'stale' }).success).toBe(false)
  })
  it('strips credential material and submitted values from response objects', () => {
    const directory = authorizationDescribeValueSchema.parse({ flows: [{ key: 'llm-pi-ai/openai-codex', label: 'Codex', methods: [], inFlight: false, configured: true, writable: true, payload: { access_token: 'private' } }] })
    expect(JSON.stringify(directory)).not.toContain('private')
    const result = authorizationPollValueSchema.parse({ attempt: { id, key: 'llm-pi-ai/openai-codex', state: 'waiting', expiresAt: 100, pollAfterMs: 20,
      prompt: { id, kind: 'secret', message: 'Code', signal: {} }, answer: 'private' } })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(result.attempt.prompt).not.toHaveProperty('signal')
  })
})
