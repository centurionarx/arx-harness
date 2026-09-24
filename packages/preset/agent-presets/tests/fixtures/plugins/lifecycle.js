// The host supplies controlled startup and teardown promises for lifecycle races.
import { apply as contribute } from './contribute.js'

export const name = 'lifecycle'
export const inject = ['tools', 'systemPrompt', 'presetLifecycle']

export async function apply(ctx, config) {
  await ctx.presetLifecycle.start(config.tool)
  contribute(ctx, config)
  ctx.effect(() => () => ctx.presetLifecycle.stop(config.tool))
}
