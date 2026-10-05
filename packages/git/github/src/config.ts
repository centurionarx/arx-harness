/** Operator configuration validation; credential values are never accepted here. */
import { credentialKey } from '@arx-ai/arx-credentials'
import type { Config, ServiceConfig } from './types.ts'

/** The only durable record this plugin may read or write. */
export const GITHUB_CREDENTIAL_KEY = credentialKey('github', 'account')
/** Safe startup without accepting a PAT until the operator selects record mode. */
export const DEFAULT_CONFIG: ServiceConfig = Object.freeze({ credential: Object.freeze({ mode: 'unconfigured' }), maxBytes: 262144, maxItems: 100, timeoutMs: 10000, pageSize: 30, maxPages: 100, patBytes: 4096 })
const ceilings = { maxBytes: 1048576, maxItems: 100, timeoutMs: 60000, pageSize: 100, maxPages: 1000, patBytes: 4096 }
/**
 * Resolve and validate operator configuration without echoing input in failures.
 * @param input - Optional overrides from composition.
 * @returns An immutable complete configuration.
 */
export function resolveConfig(input: Config): ServiceConfig {
  const config = { ...DEFAULT_CONFIG, ...input }
  const invalid = () => { throw new Error('Invalid GitHub configuration') }
  for (const key of Object.keys(ceilings) as (keyof typeof ceilings)[]) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1 || config[key] > ceilings[key]) invalid()
  }
  const raw: unknown = config.credential
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid()
  const credential = raw as ServiceConfig['credential']
  switch (credential.mode) {
    case 'unconfigured':
      if (Object.keys(credential).length !== 1) invalid()
      break
    case 'record':
      if (credential.key !== GITHUB_CREDENTIAL_KEY || Object.keys(credential).length !== 2) invalid()
      break
    case 'ref':
      if (typeof credential.ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(credential.ref) || Object.keys(credential).length !== 2) invalid()
      break
    default: invalid()
  }
  if (config.pageSize > config.maxItems) invalid()
  return Object.freeze({ ...config, credential: Object.freeze({ ...credential }) })
}
