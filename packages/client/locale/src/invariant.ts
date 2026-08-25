/**
 * Package-owned invariant companion for `@centurionarx/cxh-client-locale`.
 * @module @centurionarx/cxh-client-locale/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@centurionarx/cordis'
import type { InvariantInstaller } from '@centurionarx/cxh-invariants'

const PACKAGE_NAME = '@centurionarx/cxh-client-locale'

/** Cordis companion plugin name. */
export const name = 'client-locale-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: ns-by-locale dictionary registry with a stable
 * bind(ns) API — it emits no cordis events and owns no cross-plugin
 * mutable relation; fallback-chain resolution and locale-store behavior are
 * asserted directly by this package's behavior specs.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
