/**
 * Internal project-route admission over authenticated principal facts.
 * @module @arx-ai/arx-project-storage/http-policy
 */
import { allowsProjectAccess, identityFailure } from '@arx-ai/arx-web-identity'
import type { AuthAudience, WebPrincipal } from '@arx-ai/arx-web-identity/contract'

/**
 * Enforce the shared USER project policy after request authentication.
 * This predicate does not authenticate a request or establish ownership.
 * @param principal - Detached facts from the authenticated request authority.
 * @param audience - Fixed deployment audience from the authenticated authority.
 * @throws {WebIdentityError} When the account facts do not permit project access.
 */
export function assertOwnerHttpAccess(principal: WebPrincipal, audience: AuthAudience): void {
  if (!allowsProjectAccess(principal, audience)) identityFailure('PROJECT_DENIED', 403, 'Projects unavailable')
}
