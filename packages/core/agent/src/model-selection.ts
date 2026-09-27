/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @arx-ai/arx-agent/model-selection
 */

import type { Context } from '@arx-ai/cordis'
import type { LlmCallConfig, ReasoningEffortId } from '@arx-ai/arx-llm'
import type { Session, SessionEvent } from '@arx-ai/arx-session'
import type { Agent } from './runtime-types.ts'

/** Complete provider, model, and optional reasoning effort selected for one live Agent. */
export interface ModelSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: ReasoningEffortId
}

declare module '@arx-ai/arx-session/types' {
  interface SessionEventMap {
    /**
     * A provider, model, and optional reasoning effort accepted for this
     * session (validated against the live route before this event is
     * appended). Log-only: it never enters the derived model transcript, and
     * the config a step actually sent stays recorded by `request/header`. The
     * session's effective selection is whichever of this event and
     * `request/header` was logged last, so a request built under a different
     * config supersedes an unconsumed pick, and a later pick supersedes an
     * earlier request.
     */
    'model/selection': ModelSelection
  }
}

/** Mutable model selection plus the value captured for the current step. */
export interface ModelSelectionRef {
  /** Model selected for the next step that enters prompt assembly. */
  current: ModelSelection | undefined
  /** Selection captured when the current step entered prompt assembly. */
  assembled: ModelSelection | undefined
}

/**
 * Field-wise equality over two selections, either of which may be absent.
 * @param a - one selection, or undefined.
 * @param b - the other selection, or undefined.
 * @returns whether both are absent, or both present with matching provider, model, and reasoning effort.
 */
export function modelSelectionEquals(a: ModelSelection | undefined, b: ModelSelection | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort
}

/** Project a request header's call config onto the {@link ModelSelection} shape. */
function selectionFromCallConfig(config: LlmCallConfig): ModelSelection {
  return {
    provider: config.provider,
    model: config.model,
    ...config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort },
  }
}

/**
 * Fold a session's `model/selection` and `request/header` events into the
 * effective selection in force after the last one of either: whichever type
 * was logged last wins, so a request built under a different config
 * supersedes an earlier unconsumed pick, and a later pick supersedes an
 * earlier request. Other event types are skipped. This is the pure offline
 * reconstruction path; {@link loggedModelSelection} folds the same rule
 * incrementally over a live session.
 * @param events - session events in log order.
 * @param from - a previously folded state to continue from.
 * @returns the latest effective selection, or undefined when neither event has been logged yet.
 */
export function foldSessionModelSelection(
  events: readonly SessionEvent[],
  from?: ModelSelection,
): ModelSelection | undefined {
  let state = from
  for (const event of events) {
    if (event.type === 'model/selection') state = event.data
    else if (event.type === 'request/header') state = selectionFromCallConfig(event.data.header.config)
  }
  return state
}

/** Per-session incremental fold cache backing {@link loggedModelSelection}. */
const loggedSelectionFolds = new WeakMap<Session, { seq: number; value: ModelSelection | undefined }>()

/**
 * The effective model selection recorded by a session's own log: the latest
 * `model/selection` not superseded by a later `request/header`, else the
 * latest `request/header`, else undefined (a caller applies its own
 * deployment-default fallback for that case). Incrementally folded per
 * session — like `Session.requestHeader()` — so a per-step read while nothing
 * new was appended costs O(1) and one with new events costs O(new events),
 * never a rescan. The cache is keyed by the live `Session` object, so a cold
 * resume's fresh `Session` folds once from the restored log.
 * @param session - the session whose log to fold.
 * @returns the logged selection, or undefined when the log carries neither event.
 */
export function loggedModelSelection(session: Session): ModelSelection | undefined {
  const cached = loggedSelectionFolds.get(session)
  const consumed = cached?.seq ?? 0
  if (session.seq === consumed) return cached?.value
  const value = foldSessionModelSelection(session.events.slice(consumed), cached?.value)
  loggedSelectionFolds.set(session, { seq: session.seq, value })
  return value
}

/** Agents with a live model-selection override installed via {@link installModelSelection}. */
const installedSelections = new WeakMap<Agent, ModelSelectionRef>()

/**
 * The live model selection installed for an agent via
 * {@link installModelSelection}, or undefined when none is installed — every
 * subagent child today, since only the entry points that expose a model
 * picker install one. Delegation reads this instead of `Agent.options` so a
 * child created after its parent's live selection changed inherits the pick
 * the parent is actually running on rather than the parent's construction-time
 * default.
 * @param agent - the agent to read a live override for.
 * @returns the currently selected model, or undefined without a live override or without a current pick.
 */
export function installedModelSelection(agent: Agent): ModelSelection | undefined {
  return installedSelections.get(agent)?.current
}

/**
 * Couple one mutable selection to Agent-scoped prompt assembly and request routing.
 * Prompt assembly snapshots the selected model before delegating, then applies
 * its provider/model pair and effort to request config so a
 * concurrent switch takes effect on a later step instead of splitting the two
 * surfaces. An absent selected effort clears any inherited effort, restoring
 * the selected model's provider/default behavior.
 *
 * When `agentCtx.agent` is set, this also registers `selection` for
 * {@link installedModelSelection} for as long as the returned disposer is
 * unused (or until a later install for the same agent replaces it).
 *
 * @param agentCtx - The selected Agent's scoped context.
 * @param selection - Mutable selection owned by the calling entry point.
 * @returns Disposer for both scoped waterfall listeners.
 */
export function installModelSelection(agentCtx: Context, selection: ModelSelectionRef): () => void {
  const agent = agentCtx.agent
  if (agent !== undefined) installedSelections.set(agent, selection)
  const disposeAssembly = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const selected = selection.current
    const assembled = await next()
    selection.assembled = selected
    if (selected === undefined) return assembled
    return {
      ...assembled,
      variables: {
        ...assembled.variables,
        provider: selected.provider,
        model: selected.model,
      },
    }
  })
  const disposeRequest = agentCtx.on(
    'agent/request',
    async (_payload, next): Promise<LlmCallConfig> => {
      const resolved = await next()
      const selected = selection.assembled
      if (selected === undefined) return resolved
      const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
      return {
        ...withoutInheritedEffort,
        provider: selected.provider,
        model: selected.model,
        ...selected.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selected.reasoningEffort },
      }
    },
  )
  return () => {
    disposeAssembly()
    disposeRequest()
    if (agent !== undefined && installedSelections.get(agent) === selection) installedSelections.delete(agent)
  }
}
