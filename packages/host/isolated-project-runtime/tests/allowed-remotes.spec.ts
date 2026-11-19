/** The closed authority surface is separate from canonical Typert business codecs. */
import { describe, expect, it } from 'vitest'
import { isOwnerRemoteActivity, ownerRemoteAdmission, ownerRemoteEventAdmission } from '../src/allowed-remotes.ts'

describe('native owner Remote admission', () => {
  it('selects the existing Agent and feedback Session identities before business dispatch', () => {
    expect(ownerRemoteAdmission('commands/execute', { args: { agentId: 'owned-session', line: '/goal', images: [] } }))
      .toEqual({ resource: { kind: 'session', sessionId: 'owned-session' }, grant: 'runtime' })
    expect(ownerRemoteAdmission('messageFeedback/list', { args: { request: { sessionId: 'owned-session' } } }))
      .toEqual({ resource: { kind: 'session', sessionId: 'owned-session' }, grant: 'storage' })
    expect(ownerRemoteAdmission('settings/replace', { args: {} })).toBeUndefined()
    expect(ownerRemoteAdmission('pluginInventory/list', { args: {} })).toBeUndefined()
  })
  it('refuses malformed authority shapes, extra named args and missing Session identities', () => {
    for (const payload of [null, [], {}, { args: {}, extra: true }, { args: [] },
      { args: { agentId: 'owned-session', userId: 'submitted-owner' } }, { args: { agentId: '' } }, { args: { agentId: 1 } }]) {
      expect(() => ownerRemoteAdmission('commands/list', payload)).toThrow('Invalid project Remote request')
    }
    for (const payload of [{ args: { request: null } }, { args: { request: {} } }]) {
      expect(() => ownerRemoteAdmission('messageFeedback/list', payload)).toThrow('Invalid project Remote request')
    }
  })
})

describe('native owner Remote event admission', () => {
  it('requires an owner for preset selection and admits only empty neutral invalidations', () => {
    expect(ownerRemoteEventAdmission('agent-preset/selected', ['owned-session', 'operator-reviewed-preset']))
      .toEqual({ resource: { kind: 'session', sessionId: 'owned-session' } })
    for (const event of ['commands/change', 'llm/adapters-updated', 'web/providers-updated']) {
      expect(ownerRemoteEventAdmission(event, [])).toEqual({})
      expect(ownerRemoteEventAdmission(event, ['submitted-value'])).toBeUndefined()
    }
    for (const args of [[], ['owned-session'], [null, 'preset'], ['', 'preset'], ['owned-session', 1]]) {
      expect(ownerRemoteEventAdmission('agent-preset/selected', args)).toBeUndefined()
    }
    for (const event of ['settings/document-updated', 'credentials/record-updated', 'cordis/request-run', 'unknown']) {
      expect(ownerRemoteEventAdmission(event, [])).toBeUndefined()
    }
  })
})


describe('native owner Remote business activity', () => {
  it('keeps unknown methods and every read passive despite a supplied success-looking value', () => {
    for (const method of ['unknown', 'commands/list', 'messageFeedback/list', 'filePreviews/read'])
      expect(isOwnerRemoteActivity(method, { ok: true, result: { kind: 'success' } })).toBe(false)
  })
  it('requires the canonical command success tag rather than the RPC envelope alone', () => {
    for (const value of [undefined, null, [], {}, { result: undefined }, { result: null },
      { result: { kind: 'error', text: 'refused' } }])
      expect(isOwnerRemoteActivity('commands/execute', value)).toBe(false)
    expect(isOwnerRemoteActivity('commands/execute', { commandId: 'canonical-pair', result: { kind: 'success' } })).toBe(true)
  })
  it('requires the canonical feedback business success and admits existing goal mutations', () => {
    for (const method of ['messageFeedback/put', 'messageFeedback/delete']) {
      expect(isOwnerRemoteActivity(method, undefined)).toBe(false)
      expect(isOwnerRemoteActivity(method, { ok: false, error: { code: 'version-conflict' } })).toBe(false)
      expect(isOwnerRemoteActivity(method, { ok: true, value: {} })).toBe(true)
    }
    for (const method of ['goals/create', 'goals/edit', 'goals/pause', 'goals/resume', 'goals/complete', 'goals/clear'])
      expect(isOwnerRemoteActivity(method, undefined)).toBe(true)
  })
})
