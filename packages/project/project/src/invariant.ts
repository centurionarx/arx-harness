/** Package-owned invariant companion for the project aggregate. */

import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'
import type { DomainChanged } from '@arx-ai/arx-storage-domain'

const PACKAGE_NAME = '@arx-ai/arx-project'

/** Cordis companion plugin name. */
export const name = 'project-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** A project table key must always equal the embedded aggregate identity. */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'project' || change.table !== 'projects' || change.operation !== 'put') return
      const value = change.value as { readonly id?: unknown }
      if (value.id !== change.key) {
        fail(`project record key '${change.key}' differs from its embedded id '${String(value.id)}'`)
      }
    })
  },
  { inject: ['projects'] },
)

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
