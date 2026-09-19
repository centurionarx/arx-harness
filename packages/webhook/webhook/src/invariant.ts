/** Package-owned invariant companion for webhook ledger identity. */

import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
import type { DomainChanged } from '@arx-ai/arx-storage-domain'

const PACKAGE_NAME = '@arx-ai/arx-webhook'

export const name = 'webhook-invariant'
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'webhook' || change.table !== 'deliveries' || change.operation !== 'put') return
      const value = change.value as { readonly key?: unknown }
      if (value.key !== change.key) fail(`webhook ledger key '${change.key}' differs from embedded key '${String(value.key)}'`)
    })
  },
  { inject: ['webhookRuntime'] },
)

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
