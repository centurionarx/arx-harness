/** Package-owned invariant companion. @module @arx-ai/arx-client-ui-projects/invariant */

/* jscpd:ignore-start */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'

const PACKAGE_NAME = '@arx-ai/arx-client-ui-projects'

/** Cordis companion plugin name. */
export const name = 'client-ui-projects-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: this package owns a project presentation; durable project invariants belong to the project service. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
