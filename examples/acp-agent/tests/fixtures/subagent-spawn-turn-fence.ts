/**
 * Loader fixture that holds every child step until the top-level parent is idle
 * after its spawn turn.
 * @module subagent-spawn-turn-fence
 */

import type { Context } from '@arx-ai/cordis'
import type {} from '@arx-ai/arx-agent-loop'

/** Fixture plugin name. */
export const name = 'subagent-spawn-turn-fence'

/**
 * Keep replay scheduling from settling a background child while its parent's
 * spawn turn runs: the settlement notice would then steer into that turn
 * instead of opening the parent's next one.
 * @param ctx - assembled ACP-agent context.
 */
export function apply(ctx: Context): void {
  const parentIdle = Promise.withResolvers<undefined>()
  let hasStopped = false

  ctx.effect(() => {
    const disposeSession = ctx.root.on('session/event', (session, event) => {
      if (session.header.parentSession !== undefined || event.type !== 'turn/end' || event.data.turn !== 1) return
      hasStopped = true
    })
    const disposeStatus = ctx.root.on('agent/status', ({ agent, status }) => {
      if (agent.session.header.parentSession === undefined && status === 'idle' && hasStopped) {
        parentIdle.resolve(undefined)
      }
    })
    const disposeStep = ctx.root.on('agent/pre-step', async ({ agent }, next) => {
      if (agent.session.header.parentSession !== undefined) await parentIdle.promise
      return next()
    })
    return () => {
      parentIdle.resolve(undefined)
      disposeStep()
      disposeStatus()
      disposeSession()
    }
  }, 'subagent-spawn-turn-fence.listeners')
}
