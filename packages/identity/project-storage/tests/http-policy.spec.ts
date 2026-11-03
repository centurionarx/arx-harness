import { describe, expect, it } from 'vitest'
import { WebIdentityError } from '@arx-ai/arx-web-identity'
import { WebUserId } from '@arx-ai/arx-web-identity/contract'
import type { WebPrincipal } from '@arx-ai/arx-web-identity/contract'
import { assertOwnerHttpAccess } from '../src/http-policy.ts'

const roles = ['MASTER_ADMIN', 'USER'] as const
const statuses = ['PENDING', 'ACTIVE', 'BLOCKED', 'DELETED'] as const
const audiences = ['user', 'admin'] as const
const cases = roles.flatMap(role => statuses.flatMap(status => [false, true].flatMap(mustChangePassword =>
  audiences.map(audience => ({ role, status, mustChangePassword, audience })))))

// Detached policy facts exercise the contract; they do not issue request authority.
describe('owner HTTP admission policy', () => {
  it.each(cases)('$role/$status/change=$mustChangePassword/$audience', (facts) => {
    const principal: WebPrincipal = {
      userId: WebUserId('10000000-0000-4000-8000-000000000001'),
      username: 'policy-user', email: 'policy-user@example.invalid',
      role: facts.role, status: facts.status, mustChangePassword: facts.mustChangePassword, grants: [],
    }
    if (facts.role === 'USER' && facts.status === 'ACTIVE' && !facts.mustChangePassword && facts.audience === 'user') {
      expect(() => { assertOwnerHttpAccess(principal, facts.audience) }).not.toThrow()
      return
    }
    let failure: unknown
    try { assertOwnerHttpAccess(principal, facts.audience) }
    catch (error) { failure = error }
    expect(failure).toBeInstanceOf(WebIdentityError)
    expect(failure).toMatchObject({ name: 'WebIdentityError', code: 'PROJECT_DENIED', status: 403, message: 'Projects unavailable' })
  })
})
