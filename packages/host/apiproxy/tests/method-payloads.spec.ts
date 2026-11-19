import { describe, expect, it } from 'vitest'
import { apiMethodForName, API_METHOD_PAYLOAD_SCHEMAS, parseApiMethodPayload } from '../src/api/method-payloads.ts'

describe('shared unary method payload boundary', () => {
  it('does not mistake prototype properties or unknown methods for API routes', () => {
    expect(Object.keys(API_METHOD_PAYLOAD_SCHEMAS)).toHaveLength(64)
    expect(apiMethodForName('session.prompt')).toBe('session.prompt')
    for (const method of ['toString', '__proto__', 'unknown.call']) {
      expect(apiMethodForName(method)).toBeUndefined()
      expect(() => parseApiMethodPayload(method, {})).toThrow('unknown API method')
    }
  })
  it('shares the original payload validation and preserves local unknown-field stripping', () => {
    expect(parseApiMethodPayload('session.prompt', { sessionId: 'session', mode: 'queue', content: [] }))
      .toEqual({ sessionId: 'session', mode: 'queue', content: [] })
    expect(() => parseApiMethodPayload('session.prompt', { sessionId: 'session' })).toThrow()
    expect(() => parseApiMethodPayload('session.create', { workspaceId: 'workspace', cwd: '/tmp' })).toThrow()
    expect(parseApiMethodPayload('host.describe', { unknown: 'legacy-strip' })).toEqual({})
  })
})
