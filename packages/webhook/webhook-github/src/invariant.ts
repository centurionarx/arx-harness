/** Package-owned invariant companion for the stateless GitHub adapter. */

import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'

const PACKAGE_NAME = '@arx-ai/arx-webhook-github'

export const name = 'webhook-github-invariant'
export const inject = ['invariants']

/** No runtime invariant: authenticated requests are validated before the adapter creates any state. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
