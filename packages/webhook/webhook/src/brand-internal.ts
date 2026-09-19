/** Internal constructor for validated deterministic ledger keys. */

import type { WebhookLedgerKey as LedgerKey } from './brand.ts'

/**
 * Brand one deterministic SHA-256 reservation key after construction.
 * @param value - SHA-256 hexadecimal key.
 * @returns the branded value.
 */
export function WebhookLedgerKey(value: string): LedgerKey { return value as LedgerKey }
