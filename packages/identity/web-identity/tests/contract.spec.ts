import { describe, expect, it } from 'vitest'
import { ModuleId, ProjectId, WebUserId, parseAuthState, parseAuthProblem, parseAuthInvalidation, parseAdminUserList, parseModuleCatalog, allowsProjectAccess, deriveAuthPresentation } from '../src/contract.ts'
const principal = { userId: 'fixture-user', username: 'fixture', email: 'fixture@test.example', role: 'USER', status: 'ACTIVE', mustChangePassword: false, grants: ['storage'] }
describe('browser-safe identity DTOs', () => {
  it('validates detached immutable state and audience without accepting it as authority', () => {
    const state = parseAuthState({ authenticated: true, audience: 'user', principal, csrfToken: 'fixture', expiresAt: 1, generation: 1 })
    expect(Object.isFrozen(state)).toBe(true)
    if (state.authenticated)
      expect(Object.isFrozen(state.principal.grants)).toBe(true)
    for (const change of [{ mustChangePassword: 'yes' }, { status: 'ROOT' }, { grants: 1 }])
      expect(() => parseAuthState({ authenticated: true, audience: 'user', principal: { ...principal, ...change }, csrfToken: 'x', expiresAt: 1, generation: 1 })).toThrow()
    expect(parseAuthState({ authenticated: false, audience: 'admin' })).toEqual({ authenticated: false, audience: 'admin' })
    expect(() => parseAuthState({ authenticated: false })).toThrow()
    for (const value of [null, [], { authenticated: 'true' }, { authenticated: true, audience: 'user', principal: { ...principal, role: 'ROOT' } }]) {
      expect(() => parseAuthState(value)).toThrow()
    }
  })
  it('validates public/admin problems, invalidations, pagination and catalog', () => {
    expect(parseAuthProblem({ error: { code: 'AUTH_INVALID', message: 'Authentication required' } }).error.code).toBe('AUTH_INVALID')
    expect(() => parseAuthProblem({ error: { message: 1 } })).toThrow()
    expect(parseAuthInvalidation({ invalidated: true, generation: 1, reason: 'logout' }).reason).toBe('logout')
    expect(() => parseAuthInvalidation({ invalidated: true, generation: 1, reason: 'secret' })).toThrow()
    expect(() => parseAuthInvalidation({ invalidated: false, generation: -1 })).toThrow()
    expect(parseAuthInvalidation({ invalidated: false, generation: 1 })).toEqual({ invalidated: false, generation: 1 })
    expect(parseAdminUserList({ users: [{ ...principal, passwordEstablished: true }], nextCursor: 'fixture' }).users).toHaveLength(1)
    expect(parseAdminUserList({ users: [] })).toEqual({ users: [] })
    expect(() => parseAdminUserList({ users: 'bad' })).toThrow()
    expect(parseModuleCatalog({ modules: [{ id: 'storage', label: 'Storage', operations: ['read'] }] }).modules).toHaveLength(1)
    expect(() => parseModuleCatalog({ modules: null })).toThrow()
    expect(() => parseModuleCatalog({ modules: [{ id: 'storage', label: 'Storage', operations: [1] }] })).toThrow()
  })
  it('rejects nonstring invalidation reasons without invoking submitted coercion', () => {
    let coercionCalls = 0
    const reason = { toString() { coercionCalls++; return 'logout' } }
    expect(() => parseAuthInvalidation({ invalidated: true, generation: 1, reason })).toThrow()
    expect(coercionCalls).toBe(0)
    for (const reason of [null, 0, true, [], {}])
      expect(() => parseAuthInvalidation({ invalidated: true, generation: 1, reason })).toThrow()
  })
  it('uses a complete project-admission truth table without forging any sealed authority', () => {
    const permitted = new Set(['user/USER/ACTIVE/false'])
    for (const audience of ['user', 'admin'] as const)
      for (const role of ['USER', 'MASTER_ADMIN'] as const)
        for (const status of ['PENDING', 'ACTIVE', 'BLOCKED', 'DELETED'] as const)
          for (const mustChangePassword of [false, true]) {
            const publicFacts = { ...principal, userId: WebUserId('00000000-0000-4000-8000-000000000000'), grants: [ModuleId('storage')], role, status, mustChangePassword }
            expect(allowsProjectAccess(publicFacts, audience)).toBe(permitted.has([audience, role, status, mustChangePassword].join('/')))
          }
  })
  it('brands syntax and still requires server permission', () => {
    expect(ModuleId('storage')).toBe('storage')
    expect(() => ModuleId('arbitrary/not-id')).toThrow()
    const id = '00000000-0000-4000-8000-000000000000'
    expect(WebUserId(id)).toBe(id)
    expect(ProjectId(id)).toBe(id)
    expect(() => WebUserId('unknown')).toThrow()
  })
})

/** Pure graph metadata truth table; DTOs never act as an authority issuer. */
describe('detached auth presentation policy', () => {
  const stateFor = (audience: 'user' | 'admin', role: 'USER' | 'MASTER_ADMIN',
    status: 'PENDING' | 'ACTIVE' | 'BLOCKED' | 'DELETED' = 'ACTIVE', mustChangePassword = false,
    grants: readonly string[] = []) => parseAuthState({ authenticated: true, audience,
    principal: { userId: '11111111-1111-4111-8111-111111111111', username: 'presentation-fixture',
      email: 'presentation@fixture.test', role, status, mustChangePassword, grants },
    csrfToken: 'private-fixture-csrf', generation: 7, expiresAt: 1000 })
  it('selects public, admin and USER graphs with only the current audience and granted scope', () => {
    for (const audience of ['user', 'admin'] as const) {
      const anonymous = deriveAuthPresentation({ authenticated: false, audience })
      expect(anonymous).toEqual({ kind: 'public', audience, scope: 'application' })
      expect(Object.isFrozen(anonymous)).toBe(true)
      const role = audience === 'user' ? 'USER' : 'MASTER_ADMIN'
      for (const status of ['PENDING', 'BLOCKED', 'DELETED'] as const) {
        expect(deriveAuthPresentation(stateFor(audience, role, status, false, ['runtime'])))
          .toEqual({ kind: 'public', audience, scope: 'application', generation: 7 })
      }
      expect(deriveAuthPresentation(stateFor(audience, role, 'ACTIVE', true, ['runtime'])))
        .toEqual({ kind: 'public', audience, scope: 'application', generation: 7 })
      for (const pathname of ['/reset', '/invite']) {
        expect(deriveAuthPresentation(stateFor(audience, role, 'ACTIVE', false, ['runtime']), pathname))
          .toEqual({ kind: 'public', audience, scope: 'application', generation: 7 })
      }
    }
    const admin = deriveAuthPresentation(stateFor('admin', 'MASTER_ADMIN', 'ACTIVE', false, ['runtime']))
    expect(admin).toEqual({ kind: 'admin', audience: 'admin', generation: 7, scope: 'application' })
    expect(Object.isFrozen(admin)).toBe(true)
    for (const grants of [[], ['storage'], ['runtime'], ['storage', 'runtime']]) {
      const result = deriveAuthPresentation(stateFor('user', 'USER', 'ACTIVE', false, grants), '/entry')
      expect(result).toEqual({ kind: 'user', audience: 'user', generation: 7,
        scope: grants.includes('runtime') ? 'project' : 'application' })
      expect(Object.isFrozen(result)).toBe(true)
      expect(result).not.toHaveProperty('principal')
      expect(result).not.toHaveProperty('csrfToken')
      expect(result).not.toHaveProperty('expiresAt')
    }
  })
  it('returns no graph metadata for an audience mismatch, including recovery entries', () => {
    for (const [audience, role] of [['user', 'MASTER_ADMIN'], ['admin', 'USER']] as const) {
      for (const pathname of [undefined, '/reset', '/invite']) {
        expect(deriveAuthPresentation(stateFor(audience, role), pathname)).toBeUndefined()
      }
    }
  })
})
