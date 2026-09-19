/** Fibers removed from public discovery whose owned teardown has not settled. */
import type { Context } from './context.ts'
import type { Fiber } from './fiber.ts'

/** Root-owned disposal joins; entries remain only until their cleanup settles. */
export const unloadingFibers = new WeakMap<Context, Set<Fiber>>()
