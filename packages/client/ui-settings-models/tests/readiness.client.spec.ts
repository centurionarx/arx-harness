/** Pure provider-usability projection over the shared Models join. */
import { describe, expect, it } from 'vitest'
import type { CredentialView } from '@arx-ai/arx-api-remotes/client'
import type { ProviderRow } from '../src/client/store.ts'
import { providerUsable } from '../src/client/store.ts'

const missingCredential: CredentialView = { configured: false, writable: true }

/** A provider the user configured themselves. */
function row(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    entry: {
      provider: 'hfai',
      displayName: 'HFAI',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'hfai'],
      active: true,
    },
    configured: true,
    removable: true,
    apiKeyEnv: 'HFAI_API_KEY',
    credential: { configured: true, source: 'file', writable: true },
    ...overrides,
  }
}

describe('providerUsable', () => {
  it('requires a registered route and a stored key for every named reference', () => {
    expect(providerUsable(row())).toBe(true)
    expect(providerUsable(row({ entry: { ...row().entry, active: false } }))).toBe(false)
    expect(providerUsable(row({ credential: missingCredential }))).toBe(false)
    expect(providerUsable(row({ credential: undefined }))).toBe(false)
  })

  it('treats a reference-free registered route as provider-native authentication', () => {
    expect(providerUsable(row({ apiKeyEnv: undefined, credential: undefined }))).toBe(true)
  })

  it('accepts a read-only launch-environment credential', () => {
    expect(providerUsable(row({ credential: { configured: true, source: 'env', writable: false } }))).toBe(true)
  })
})
