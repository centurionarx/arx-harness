import { describe, expect, it } from 'vitest'
import { credentialKey, credentialRef } from '@arx-ai/arx-credentials'
import { DEFAULT_CONFIG, GITHUB_CREDENTIAL_KEY, resolveConfig } from '../src/config.ts'
import type { ServiceConfig } from '../src/types.ts'

const ceilings = { maxBytes: 1048576, maxItems: 100, timeoutMs: 60000, pageSize: 100, maxPages: 1000, patBytes: 4096 } as const

describe('GitHub operator configuration', () => {
  it('resolves defaults without enabling authentication', () => {
    expect(resolveConfig({})).toEqual(DEFAULT_CONFIG)
    expect(resolveConfig({}).credential).toEqual({ mode: 'unconfigured' })
  })

  for (const [key, ceiling] of Object.entries(ceilings)) {
    it.each([0, -1, 0.5, ceiling + 1, Number.NaN, Number.POSITIVE_INFINITY])('rejects ' + key + ' bound %s without echoing input', (value) => {
      expect(() => resolveConfig({ [key]: value })).toThrow('Invalid GitHub configuration')
    })
    it('accepts the exact ' + key + ' ceiling', () => {
      expect(resolveConfig({ [key]: ceiling })[key as keyof typeof ceilings]).toBe(ceiling)
    })
  }

  it('rejects a requested page larger than its item budget', () => {
    expect(() => resolveConfig({ maxItems: 1, pageSize: 2 })).toThrow('Invalid GitHub configuration')
  })

  it('accepts only explicit approved record or reference modes', () => {
    expect(resolveConfig({ credential: { mode: 'record', key: GITHUB_CREDENTIAL_KEY } }).credential).toEqual({ mode: 'record', key: GITHUB_CREDENTIAL_KEY })
    const ref = credentialRef('FIXTURE_PAT')
    expect(resolveConfig({ credential: { mode: 'ref', ref } }).credential).toEqual({ mode: 'ref', ref })
    expect(() => resolveConfig({ credential: { mode: 'record', key: credentialKey('other', 'account') } })).toThrow('Invalid GitHub configuration')
  })

  it.each([
    { mode: 'ambient' }, { mode: 'unconfigured', token: 'MUST-NOT-LEAK' },
    { mode: 'ref', ref: 'BAD NAME' }, { mode: 'ref', ref: 'A'.repeat(129) },
    { mode: 'record', key: 'github/account', token: 'MUST-NOT-LEAK' },
    null,
  ])('rejects malformed composition credentials without echoing secrets %#', (credential) => {
    const invoke = () => resolveConfig({ credential } as unknown as Partial<ServiceConfig>)
    expect(invoke).toThrow('Invalid GitHub configuration')
    try { invoke() } catch (error) { expect(String(error)).not.toContain('MUST-NOT-LEAK') }
  })
})
