/**
 * Package-owned invariant companion for `@arx-ai/arx-file-preview`.
 * @module @arx-ai/arx-file-preview/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@arx-ai/cordis'
import type { InvariantInstaller } from '@arx-ai/arx-invariants'

const PACKAGE_NAME = '@arx-ai/arx-file-preview'

/** Cordis companion plugin name. */
export const name = 'file-preview-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: this read-only Remote service records no domain state.
 * Its method enforces scoped filesystem access and bounds at the request boundary. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
