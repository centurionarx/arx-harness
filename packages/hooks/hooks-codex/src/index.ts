/**
 * Bridge for unmodified Codex command hooks on harness interception points. It
 * supports five points (SessionStart, prompt/tool pre/post, Stop), regex-only
 * matchers, snake_case payloads without a trailing newline, no hook environment
 * or command substitution, and no pre-tool approval or rewrite path; only
 * blocking decisions are honored. Shared execution and parsing live in
 * `arx-hook-protocol`; see the
 * [hook-bridges Agent Note](../../../../.agents/notes/implemented/feature/2026-06-30-hook-bridges.md).
 * @module @arx-ai/arx-hooks-codex
 */

// Each dialect bridge keeps its complete dependency list visible at the entry
// point; a cross-package facade for imports alone would add indirection.
/* jscpd:ignore-start */
import { readFileSync } from 'node:fs'
import type { Context } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import type { Agent, PreStepDecision, SessionStartSource } from '@arx-ai/arx-agent'
import { createUserMessage } from '@arx-ai/arx-llm'
import type { ContentBlock, MessageSource } from '@arx-ai/arx-llm'
import type { UserMessage } from '@arx-ai/arx-session'
import type {} from '@arx-ai/arx-session-persistence'
import type { PostToolDecision, PreToolDecision, ToolExecution, ToolExecutionResult } from '@arx-ai/arx-tools'
import {
  createDetachedRuns,
  createHookHandlerIds,
  createHookLifecycle,
  createHookPointRunner,
  resolveHookPolicy,
  hookPolicyFields,
  preToolDenial,
  type MergedHookOutcome,
} from '@arx-ai/arx-hook-protocol'
import { parseCodexConfig, type CodexHookConfig } from './config.ts'
/* jscpd:ignore-end */

export const name = 'hooks-codex'
export const inject = ['shell']

/** Plugin config: where the Codex hooks.json lives + the model name for payloads. */
export interface Config {
  /**
   * Path to a Codex `hooks.json`. Process-level: read once at load, a relative
   * path resolves against the process launch cwd.
   * TODO(per-session-hook-config): per-session project-local discovery from each
   * `session/new.cwd`.
   */
  configPath: string
  /** The model name stamped on every payload (Codex includes `model` on each event). */
  model?: string
  /** Default per-hook timeout in ms when a hook sets none (Codex default: 600000). */
  defaultTimeoutMs?: number
  /** Character cap for the `hook/result` event's persisted stderr summary. */
  stderrSummaryMaxChars?: number
  /** Maximum Stop-forced steps per agent turn; zero observes without continuing (default: 8). */
  maxStopContinuations?: number
  /** Await SessionStart in the first pre-step, or inject eagerly without a first-request guarantee. */
  sessionStartMode?: 'blocking' | 'detached'
}

export const Config: z<Config> = z.object({
  configPath: z.string().required(),
  model: z.string().default(''),
  ...hookPolicyFields(),
})

const nextHandlerId = createHookHandlerIds('codex')

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'hooks-codex' }

export function apply(ctx: Context, config: Config): void {
  const policy = resolveHookPolicy(config, name)
  let parsed: CodexHookConfig = {}
  try {
    const raw: unknown = JSON.parse(readFileSync(config.configPath, 'utf8'))
    const result = parseCodexConfig(raw)
    parsed = result.config
    for (const s of result.skipped) {
      ctx.logger.warn(`hooks-codex: skipping ${s.reason} on ${s.event} (only sync command hooks run)`)
    }
  } catch (error: unknown) {
    ctx.logger.warn(`hooks-codex: could not load hook config "${config.configPath}": ${String(error)} — no hooks registered`)
    return
  }

  const model = config.model ?? ''

  const lifecycle = createHookLifecycle<Agent, SessionStartSource>(policy)
  const detached = lifecycle.runs
  ctx.on('agent/disposed', ({ agent }) => { lifecycle.forget(agent) })
  ctx.effect(() => () => detached.drain(), 'hooks-codex: drain detached hook runs')

  const executePoint = createHookPointRunner(ctx.shell, {
    groups: parsed, dialect: 'codex', policy, runs: detached, nextHandlerId,
    trailingNewline: false,
    now: () => performance.now(),
    observeOutput(point, output) {
      if (output.systemMessage !== undefined) {
        ctx.logger.warn(`hooks-codex: ${point} hook emitted a systemMessage, which is not yet surfaced (ignored)`)
      }
    },
  })

  /** Supply Codex plain-stdout context policy and session ownership. */
  function runPoint(
    point: string,
    matchQuery: string,
    payload: unknown,
    opts: { agent?: Agent; turn?: number; readonly signal: AbortSignal; plainStdoutAsContext?: boolean },
  ): Promise<MergedHookOutcome> {
    const { agent, ...execution } = opts
    return executePoint({ ...execution, point, matchQuery, payload, session: agent?.session })
  }

  /* jscpd:ignore-start */
  function contextFrom(merged: MergedHookOutcome): UserMessage | undefined {
    if (merged.additionalContext.length === 0) return undefined
    const content: ContentBlock[] = merged.additionalContext.map(text => ({ type: 'text', text }))
    return createUserMessage({ content, source: PLUGIN_SOURCE })
  }

  /** Prepend one context without flattening source fields or other downstream metadata. */
  function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
    return [ours, ...theirs ?? []]
  }

  // Blocking startup belongs to the first claimed turn, including resumed sessions.
  // Context enters only through the accepted pre-step decision, which the driver logs.
  ctx.on('agent/session-start', ({ agent, source }) => {
    if (policy.sessionStartMode === 'blocking') {
      lifecycle.start(agent, source)
      return
    }
    const owned = createDetachedRuns()
    agent.ctx.effect(() => () => owned.drain(), 'hooks-codex: drain agent startup')
    const run = runPoint('SessionStart', source, { ...base(ctx, agent, 'SessionStart', model), source }, { agent, plainStdoutAsContext: true, signal: owned.signal })
      .then((merged) => {
        if (owned.signal.aborted || detached.signal.aborted) return
        if (merged.stop) {
          agent.cancel({ kind: 'hook', reason: merged.stopReason ?? 'halted by SessionStart hook' })
          return
        }
        const context = contextFrom(merged)
        if (context) agent.inject(context)
      })
      .catch((error: unknown) => {
        if (!owned.signal.aborted && !detached.signal.aborted) {
          ctx.logger.warn(`hooks-codex: SessionStart hook failed: ${String(error)}`)
        }
      })
    owned.track(run)
    detached.track(run)
  })

  ctx.on('agent/pre-step', async ({ agent, turn, signal }, next): Promise<PreStepDecision> => {
    const source = lifecycle.takeStart(agent)
    if (source === undefined) return next()
    const merged = await runPoint('SessionStart', source, { ...base(ctx, agent, 'SessionStart', model), source }, { agent, turn, plainStdoutAsContext: true, signal })
    if (merged.stop) {
      agent.cancel({ kind: 'hook', reason: merged.stopReason ?? 'halted by SessionStart hook' })
      return { kind: 'reject' }
    }
    const downstream = await next()
    if (signal.aborted || detached.signal.aborted) return { kind: 'reject' }
    const context = contextFrom(merged)
    if (!context || downstream.kind !== 'enter') return downstream
    return { kind: 'enter', messages: [context, ...downstream.messages] }
  })
  /* jscpd:ignore-end */

  // UserPromptSubmit → PreStepDecision. Codex supports reject, not rewrite or ask.
  ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next): Promise<PreStepDecision> => {
    if (messages.length === 0) return next()
    const payload = {
      ...base(ctx, agent, 'UserPromptSubmit', model),
      turn_id: String(turn),
      prompt: blocksToText(messages.flatMap(message => message.content)),
    }
    const merged = await runPoint('UserPromptSubmit', '', payload, {
      agent, turn, plainStdoutAsContext: true, signal,
    })
    /* jscpd:ignore-start */
    if (merged.stop) {
      agent.cancel({ kind: 'hook', reason: merged.stopReason ?? 'halted by UserPromptSubmit hook' })
      return { kind: 'reject' }
    }
    if (merged.decision === 'deny') {
      return { kind: 'reject' }
    }
    // Context alone is not a veto: DELEGATE so a later pre-step listener can
    // still reject/rewrite, then fold our context onto its decision.
    const downstream = await next()
    const ours = contextFrom(merged)
    if (!ours || downstream.kind !== 'enter') return downstream
    return {
      kind: 'enter',
      messages: [...downstream.messages, ours],
    }
  })

  // PreToolUse → PreToolDecision. Codex blocks only (no allow/ask honored).
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const turn = lastTurn(exec.agent)
    const merged = await runPoint('PreToolUse', exec.name, preToolPayload(ctx, exec, model), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
    /* jscpd:ignore-end */
    const denial = preToolDenial(merged, reason => exec.agent?.cancel({ kind: 'hook', reason }))
    if (denial !== undefined) return denial
    return next()
  })

  // PostToolUse → PostToolDecision (block with feedback, or attach context).
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const turn = lastTurn(exec.agent)
    /* jscpd:ignore-start */
    const merged = await runPoint('PostToolUse', exec.name, postToolPayload(ctx, exec, result, model), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
    const context = contextFrom(merged)
    if (merged.stop) {
      exec.agent?.cancel({ kind: 'hook', reason: merged.stopReason ?? 'halted by PostToolUse hook' })
      return { kind: 'block', feedback: [{ type: 'text', text: merged.reason ?? merged.stopReason ?? 'halted by PostToolUse hook' }], ...context ? { additionalContexts: [context] } : {} }
    }
    if (merged.decision === 'deny') {
      return { kind: 'block', feedback: [{ type: 'text', text: merged.reason ?? 'blocked by PostToolUse hook' }], ...context ? { additionalContexts: [context] } : {} }
    }
    // Context alone is not a veto: DELEGATE, then fold our context onto the
    // downstream decision (a downstream block carries it too).
    const downstream = await next()
    if (!context) return downstream
    if (downstream.kind === 'block') {
      return { ...downstream, additionalContexts: prependContext(context, downstream.additionalContexts) }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(context, downstream.additionalContexts),
    }
  })

  // The limit applies to steering, not hook execution: exhausted hooks still observe Stop.
  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }): Promise<void> => {
    const active = lifecycle.stopActive(agent, turn)
    const merged = await runPoint('Stop', '', { ...turnBase(ctx, agent, 'Stop', model), stop_hook_active: active, last_assistant_message: null }, { agent, turn, signal })
    /* jscpd:ignore-end */
    lifecycle.settleStop(agent, turn, signal, merged, {
      halt(reason) { agent.cancel({ kind: 'hook', reason }) },
      steer(text) { agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE })) },
      limit() { ctx.logger.warn(`hooks-codex: Stop continuation limit (${policy.maxStopContinuations}) reached for agent ${agent.id}, turn ${turn}`) },
    })
  })
}

// --- Codex DIALECT payloads: snake_case, model on every event, turn_id on
// turn-scoped events. ---

// These small payload helpers intentionally remain next to the dialect shape;
// sharing them would pull bridge-only agent/LLM dependencies into hook-protocol.
/* jscpd:ignore-start */
function lastTurn(agent: Agent | undefined): number {
  if (!agent) return 0
  const last = [...agent.session.events].findLast(e => e.type === 'turn/start')
  /* v8 ignore next -- agent-present turnBase callers are tool/stop extension points inside an open turn. */
  return last?.type === 'turn/start' ? last.data.turn : 0
}

function blocksToText(content: ContentBlock[]): string {
  return content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('')
}
/* jscpd:ignore-end */

/** Base fields on every Codex payload (no turn_id). */
function base(ctx: Context, agent: Agent | undefined, event: string, model: string): Record<string, unknown> {
  return {
    session_id: agent?.session.header.id ?? '',
    transcript_path: agent === undefined
      ? null
      : ctx.get('sessionPersistence')?.locate(agent.session.header)?.path ?? null,
    cwd: agent?.session.header.cwd ?? process.cwd(),
    hook_event_name: event,
    model,
    permission_mode: 'default',
  }
}

/** Base + turn_id, for the turn-scoped events (PreToolUse/PostToolUse/UserPromptSubmit/Stop). */
function turnBase(ctx: Context, agent: Agent | undefined, event: string, model: string): Record<string, unknown> {
  return { ...base(ctx, agent, event, model), turn_id: String(lastTurn(agent)) }
}

/** Extract a `command` string from a tool call's parsed arguments, else ''. */
function commandOf(args: unknown): string {
  if (typeof args === 'object' && args !== null && 'command' in args) {
    const command: unknown = args.command
    if (typeof command === 'string') return command
  }
  return ''
}

function preToolPayload(ctx: Context, exec: ToolExecution, model: string): Record<string, unknown> {
  // `tool_name` is the REAL tool name (matching the `exec.name` matcher subject);
  // a hardcoded constant would disagree with what the matcher tests and make a
  // config's tool matcher never fire. `tool_input` keeps Codex's `{ command }`
  // shape (its shell payload), derived from the call's `command` arg when present.
  return { ...turnBase(ctx, exec.agent, 'PreToolUse', model), tool_name: exec.name, tool_input: { command: commandOf(exec.arguments) }, tool_use_id: exec.callId }
}

function postToolPayload(ctx: Context, exec: ToolExecution, result: ToolExecutionResult, model: string): Record<string, unknown> {
  return { ...turnBase(ctx, exec.agent, 'PostToolUse', model), tool_name: exec.name, tool_input: { command: commandOf(exec.arguments) }, tool_use_id: exec.callId, tool_response: blocksToText(result.content) }
}
