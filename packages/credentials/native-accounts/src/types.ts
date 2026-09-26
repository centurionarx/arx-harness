/** Browser-safe descriptions of native product accounts and private login attempts. */
import type { Branded } from '@arx-ai/arx-brand'

/** Native product that owns its login storage. */
export type NativeAccountProvider = 'claude-code' | 'codex'
/** Private, unguessable login capability; never included in account listings. */
export type NativeAccountAttemptId = Branded<'native-account-attempt'>
/** Login mechanisms supported by the pinned product. */
export type NativeLoginMode = 'browser' | 'device-code'
/**
 * What a pending attempt asks the person to paste: `code` is the product's own
 * authorization-code prompt; `redirect-url` is the address the browser shows
 * after a browser sign-in whose return address that browser could not reach.
 */
export type NativeLoginInput = 'code' | 'redirect-url'
/** Model metadata returned by a native product; capacities are not guessed. */
export interface NativeAccountModel {
  id: string
  name: string
  resolvedModel?: string
  efforts?: string[]
}
/** Sanitized state of an installed native product. */
export interface NativeAccountView {
  provider: NativeAccountProvider
  label: string
  availability: 'available' | 'unavailable'
  status: 'connected' | 'disconnected' | 'unknown'
  authMode?: 'subscription' | 'api-key'
  models?: NativeAccountModel[]
  loginModes: NativeLoginMode[]
  loginInFlight: boolean
}
/** One bounded login attempt; only its initiating surface receives its id. */
export interface NativeAccountAttempt {
  id: NativeAccountAttemptId
  provider: NativeAccountProvider
  state: 'starting' | 'waiting' | 'connected' | 'cancelled' | 'expired' | 'failed'
  expiresAt: number
  pollAfterMs: number
  url?: string
  code?: string
  message?: string
  input?: NativeLoginInput
}
