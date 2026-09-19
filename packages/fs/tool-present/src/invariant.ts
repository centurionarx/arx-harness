/** Durable delivery ownership and file-reference validation. @module @arx-ai/arx-tool-present/invariant */
import type { Context } from '@arx-ai/cordis'
import type { Session, SessionEvent } from '@arx-ai/arx-session'
import type { InvariantFailure, InvariantInstaller } from '@arx-ai/arx-invariants'
import type {} from './types.ts'

/** Stable companion identity. */
export const name = 'tool-present-invariant'
/** Service required before reserving package ownership. */
export const inject = ['invariants']

function validate(history: readonly SessionEvent[], event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'deliverables/presented') return
  const { turn, callId, files } = event.data
  const boundary = history.findLast(prior => prior.type === 'turn/start' || prior.type === 'turn/end')
  if (boundary?.type !== 'turn/start' || boundary.data.turn !== turn) {
    fail('deliverables/presented must belong to the open turn')
  }
  if (typeof callId !== 'string' || callId.length === 0) fail('deliverables/presented requires a call id')
  if (!Array.isArray(files) || files.length === 0) fail('deliverables/presented requires files')
  const candidates: readonly unknown[] = files
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) {
      fail('deliverables/presented requires file records')
    }
    const file = candidate as Record<string, unknown>
    if (typeof file.path !== 'string' || file.path.trim().length === 0
      || (file.description !== undefined && typeof file.description !== 'string')) {
      fail('deliverables/presented requires file paths and optional text descriptions')
    }
  }
}

/** Reconstruct the owning turn from loaded history and validate candidates before publication. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    const history: SessionEvent[] = []
    for (const event of session.events) {
      validate(history, event, fail)
      history.push(event)
    }
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validate(session.events, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the delivery invariant.
 * @param ctx - context carrying the invariant registry.
 * @returns the registration disposer after setup.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@arx-ai/arx-tool-present', install))
