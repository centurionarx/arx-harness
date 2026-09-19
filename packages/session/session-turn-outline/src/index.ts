/** Registers the optional whole-session turn outline projection. */
import type { Context } from '@arx-ai/cordis'
import { TurnOutlineService } from './service.ts'
export { TurnOutlineService } from './service.ts'
import { turnOutlineDefinition } from './projection.ts'
export type * from './types.ts'
/** Cordis function-plugin identity. */
export const name = 'session-turn-outline'
/** The projection registry owns replay, delivery, and cache validation. */
export const inject = ['sessionProjections']
/** Register the fold for this plugin's lifetime. */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(turnOutlineDefinition)
  ctx.plugin(TurnOutlineService)
}
