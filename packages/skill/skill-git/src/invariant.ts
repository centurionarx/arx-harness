/** Package-owned invariant companion for the revision-pinned Git skill provider. */

/* jscpd:ignore-start */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'

const PACKAGE_NAME = '@arx-ai/arx-skill-git'
export const name = 'skill-git-invariant'
export const inject = ['invariants']
// No runtime invariant: cache and provenance checks run at every snapshot boundary.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
