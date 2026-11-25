/**
 * Package-owned relational invariants for the session event log. Load this
 * companion beside `@arx-ai/arx-invariants` to enable the checks.
 *
 * @module @arx-ai/arx-session/invariant
 */

import type { Context } from '@arx-ai/cordis'
import { assertNever } from '@arx-ai/arx-llm'
import type { CallId } from '@arx-ai/arx-llm'
import type { InvariantFailure, InvariantInstaller } from '@arx-ai/arx-invariants'
import type { Session, SessionEvent } from '@arx-ai/arx-session'
import { TOOL_NOT_STARTED } from './repair.ts'

const PACKAGE_NAME = '@arx-ai/arx-session'

/** Cordis companion plugin name. */
export const name = 'session-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Per-session bookkeeping for relational log checks. */
interface SessionTrace {
  lastSeq: number
  openTurn: number | null
  openStep: number | null
  nextTurn: number
  nextStep: number
  /**
   * The open step's model calls that have no result yet: `requested` by the
   * assistant message, `started` once their `tool/call` is recorded.
   */
  unansweredCalls: Map<CallId, 'requested' | 'started'>
}

/** One accepted event's deferred mutation of a committed session trace. */
interface SessionTraceTransition {
  scalars: Pick<SessionTrace, 'lastSeq' | 'openTurn' | 'openStep' | 'nextTurn' | 'nextStep'>
  calls:
    | { kind: 'none' }
    | { kind: 'request'; callIds: readonly CallId[] }
    | { kind: 'start' | 'answer'; callId: CallId }
    | { kind: 'clear' }
}

/** Assert that a step-scoped event names the currently open turn and step. */
function requireOpenStep(
  trace: SessionTrace,
  kind: string,
  turn: number,
  step: number,
  fail: InvariantFailure,
): void {
  if (trace.openTurn !== turn || trace.openStep !== step) {
    fail(`${kind} names turn ${turn}/step ${step} but open is turn ${trace.openTurn}/step ${trace.openStep}`)
  }
}

/** Validate one candidate event without mutating the committed trace. */
function validateEvent(
  trace: SessionTrace,
  event: SessionEvent,
  fail: InvariantFailure,
): SessionTraceTransition {
  if (event.seq <= trace.lastSeq) {
    fail(`seq must strictly increase: saw ${event.seq} after ${trace.lastSeq}`)
  }
  let openTurn = trace.openTurn
  let openStep = trace.openStep
  let nextTurn = trace.nextTurn
  let nextStep = trace.nextStep
  let calls: SessionTraceTransition['calls'] = { kind: 'none' }

  // Context and plugin-owned log-only events may be appended between model
  // executions. Core execution events retain their explicit turn relations.
  switch (event.type) {
    case 'turn/start': {
      if (trace.openTurn !== null) {
        fail(`turn/start ${event.data.turn} while turn ${trace.openTurn} is still open`)
      }
      if (event.data.turn !== trace.nextTurn) {
        fail(`turn/start expected turn ${trace.nextTurn}, got ${event.data.turn}`)
      }
      openTurn = event.data.turn
      nextStep = 1
      break
    }
    case 'turn/end': {
      if (trace.openTurn !== event.data.turn) {
        fail(`turn/end ${event.data.turn} does not match open turn ${trace.openTurn}`)
      }
      if (trace.openStep !== null) {
        fail(`turn/end ${event.data.turn} while step ${trace.openStep} is still open`)
      }
      openTurn = null
      nextTurn += 1
      break
    }
    case 'step/start': {
      if (trace.openTurn !== event.data.turn) {
        fail(`step/start in turn ${event.data.turn} but open turn is ${trace.openTurn}`)
      }
      if (trace.openStep !== null) {
        fail(`step/start ${event.data.step} while step ${trace.openStep} is still open`)
      }
      if (event.data.step !== trace.nextStep) {
        fail(`step/start expected step ${trace.nextStep} in turn ${event.data.turn}, got ${event.data.step}`)
      }
      openStep = event.data.step
      break
    }
    case 'step/end': {
      requireOpenStep(trace, 'step/end', event.data.turn, event.data.step, fail)
      // Providers reject a request whose history holds a call without its result.
      if (trace.unansweredCalls.size > 0) {
        fail(`step/end closes turn ${event.data.turn}/step ${event.data.step} with unanswered tool calls: ${[...trace.unansweredCalls.keys()].join(', ')}`)
      }
      calls = { kind: 'clear' }
      openStep = null
      nextStep += 1
      break
    }
    case 'assistant/chunk': {
      requireOpenStep(trace, 'assistant/chunk', event.data.turn, event.data.step, fail)
      break
    }
    case 'assistant/message': {
      requireOpenStep(trace, 'assistant/message', event.data.turn, event.data.step, fail)
      const callIds = event.data.message.content.flatMap(block => block.type === 'tool-call' ? [block.id] : [])
      if (callIds.length > 0) calls = { kind: 'request', callIds }
      break
    }
    case 'tool/call': {
      requireOpenStep(trace, 'tool/call', event.data.turn, event.data.step, fail)
      calls = { kind: 'start', callId: event.data.callId }
      break
    }
    case 'tool/result': {
      // Session has already validated a content rewrite that cites its replaced event.
      // It is durable turn work, not a second execution of the original call.
      if (event.surfaceOp !== 'append') {
        if (trace.openTurn === null) {
          fail('tool/result surface replacement appended outside any open turn')
        }
        break
      }
      requireOpenStep(trace, 'tool/result', event.data.turn, event.data.step, fail)
      const callId = event.data.message.source.callId
      const syntheticNotStarted = event.data.message.content[0].isError === true && event.data.error?.code === TOOL_NOT_STARTED
      if (trace.unansweredCalls.get(callId) !== 'started' && !syntheticNotStarted) {
        fail(`tool/result for ${callId} with no prior tool/call in this step`)
      }
      calls = { kind: 'answer', callId }
      break
    }
    case 'user/message':
      break
    case 'session/end-seed':
      // Unconstrained: an unbalanced seed legally puts it inside an open turn.
      break
    case 'todo/write':
    case 'request/header':
    case 'request/context': {
      if (trace.openTurn === null) {
        fail(`${event.type} appended outside any open turn (core execution events must be turn-enclosed)`)
      }
      break
    }
    default:
      // Merge-extensible event relations belong to their owning plugin.
      break
  }
  return {
    scalars: { lastSeq: event.seq, openTurn, openStep, nextTurn, nextStep },
    calls,
  }
}

/** Apply one already-validated transition after its event commits. */
function applyTransition(trace: SessionTrace, transition: SessionTraceTransition): void {
  Object.assign(trace, transition.scalars)
  const { calls } = transition
  switch (calls.kind) {
    case 'none':
      break
    case 'request':
      for (const callId of calls.callIds) trace.unansweredCalls.set(callId, 'requested')
      break
    case 'start':
      trace.unansweredCalls.set(calls.callId, 'started')
      break
    case 'answer':
      trace.unansweredCalls.delete(calls.callId)
      break
    case 'clear':
      trace.unansweredCalls.clear()
      break
    /* v8 ignore next -- validateEvent produces this closed transition union */
    default:
      assertNever(calls, 'session trace tool-call transition')
  }
}

/** Install the session contribution into its child registration fiber. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, SessionTrace>()
  const stagedTransitions = new WeakMap<SessionEvent, {
    session: Session
    trace: SessionTrace
    transition: SessionTraceTransition
  }>()

  const freshTrace = (): SessionTrace => ({
    lastSeq: -1,
    openTurn: null,
    openStep: null,
    nextTurn: 1,
    nextStep: 1,
    unansweredCalls: new Map(),
  })

  const seedSession = (session: Session): SessionTrace => {
    const trace = freshTrace()
    traces.set(session, trace)
    for (const event of session.events) {
      applyTransition(trace, validateEvent(trace, event, fail))
    }
    return trace
  }

  /* v8 ignore next -- session/event always follows list() or session/created seeding */
  const traceFor = (session: Session): SessionTrace => traces.get(session) ?? seedSession(session)

  for (const session of ctx.sessions.list()) seedSession(session)

  ctx.on('session/created', (session) => { seedSession(session) }, { global: true })

  ctx.on('session/event', (session, event) => {
    const staged = stagedTransitions.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments */
    if (staged === undefined || staged.session !== session) {
      return fail('session/event reached publication without matching pre-commit validation')
    }
    stagedTransitions.delete(event)
    applyTransition(staged.trace, staged.transition)
  }, { global: true })

  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const trace = traceFor(session)
    const transition = validateEvent(trace, event, fail)
    // A later dispatch listener may veto. Validation is pure, so abandoning
    // this weakly keyed transition does not advance or retain the session.
    stagedTransitions.set(event, { session, trace, transition })
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the session invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
