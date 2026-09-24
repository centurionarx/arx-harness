/**
 * Bridge for unmodified Claude Code command hooks on harness interception
 * extension points. It supports SessionStart, prompt/tool pre/post, Stop, and subagent
 * start/stop. It owns Claude payloads, environment, substitution, and decision
 * mapping; shared execution and parsing live in `arx-hook-protocol`.
 * `updatedInput` is logged and warned but not honored. Bespoke behavior should
 * use typed native plugins on the same extension points; see the
 * [hook-bridges Agent Note](../../../../.agents/notes/implemented/feature/2026-06-30-hook-bridges.md).
 * @module @arx-ai/arx-hooks-claude-code
 */

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
// Pulls in the declaration-merged subagent events and the identity pairing their
// start/end edges.
import type { SubagentRunId } from '@arx-ai/arx-subagent'
import { parseClaudeCodeConfig, type ClaudeCodeHookConfig } from './config.ts'

export const name = 'hooks-claude-code'
// `bash` is required to run hooks; the rest are read opportunistically via
// ctx.get so a deployment can load this bridge without every extension point present.
export const inject = ['shell']

/** Plugin config: where the CC hook config lives + substitution roots. */
export interface Config {
  /**
   * Path to a `hooks.json` or a settings file whose `hooks` key holds the config.
   * Process-level: read once at load, a relative path resolves against the process
   * launch cwd, so one config applies to the whole process.
   * TODO(per-session-hook-config): per-session discovery of a project-local
   * `hooks.json` from each `session/new.cwd`.
   */
  configPath: string
  /**
   * Replaces `${CLAUDE_PLUGIN_ROOT}` in command strings (the plugin's root dir).
   */
  pluginRoot?: string
  /**
   * Replaces `${CLAUDE_PROJECT_DIR}` in command strings AND is exported as the
   * `CLAUDE_PROJECT_DIR` env var for hook processes. When omitted, the env var
   * defaults per-run to the agent's session workspace (`session.header.cwd`, the
   * same dir the hook runs in) — Claude Code always exports this var, and common
   * unmodified hooks reference `$CLAUDE_PROJECT_DIR` for project-relative paths.
   */
  projectDir?: string
  /** Default per-hook timeout in ms when a hook sets none (CC default: 600000). */
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
  pluginRoot: z.string(),
  projectDir: z.string(),
  ...hookPolicyFields(),
})

/** A stable per-handler id so an invoked/result pair correlates in the log. */
const nextHandlerId = createHookHandlerIds('claude-code')

/** The `{kind:'plugin'}` source stamped on every context this bridge injects. */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'hooks-claude-code' }

export function apply(ctx: Context, config: Config): void {
  const policy = resolveHookPolicy(config, name)
  // Parse once at load. A read or parse failure logs and registers nothing.
  let parsed: ClaudeCodeHookConfig = {}
  try {
    const raw: unknown = JSON.parse(readFileSync(config.configPath, 'utf8'))
    const result = parseClaudeCodeConfig(raw, {
      ...config.pluginRoot !== undefined ? { pluginRoot: config.pluginRoot } : {},
      ...config.projectDir !== undefined ? { projectDir: config.projectDir } : {},
    })
    parsed = result.config
    for (const s of result.skipped) {
      ctx.logger.warn(`hooks-claude-code: skipping unsupported "${s.type}" hook on ${s.event} (only command hooks run)`)
    }
  } catch (error: unknown) {
    ctx.logger.warn(`hooks-claude-code: could not load hook config "${config.configPath}": ${String(error)} — no hooks registered`)
    return
  }

  const lifecycle = createHookLifecycle<Agent, SessionStartSource>(policy)
  const detached = lifecycle.runs
  ctx.on('agent/disposed', ({ agent }) => { lifecycle.forget(agent) })
  // Only the start edge guarantees registry access. Retain each local child
  // through its paired end so stop hooks keep the session workspace after the
  // handle unregisters the agent. Every retained entry relies on that paired
  // end; a producer that can omit it must provide another release edge.
  const subagentChildren = new Map<SubagentRunId, Agent>()
  ctx.effect(() => () => detached.drain(), 'hooks-claude-code: drain detached hook runs')

  const executePoint = createHookPointRunner(ctx.shell, {
    groups: parsed, dialect: 'claude-code', policy, runs: detached, nextHandlerId,
    trailingNewline: true,
    now: () => performance.now(),
    observeOutput(point, output) {
      if (output.updatedInput !== undefined) {
        ctx.logger.warn(`hooks-claude-code: ${point} hook requested updatedInput, which is not yet honored (ignored)`)
      }
      if (output.systemMessage !== undefined) {
        ctx.logger.warn(`hooks-claude-code: ${point} hook emitted a systemMessage, which is not yet surfaced (ignored)`)
      }
    },
  })

  /** Supply Claude project environment and session ownership. */
  function runPoint(
    point: string,
    matchQuery: string,
    payload: unknown,
    opts: { agent?: Agent; turn?: number; readonly signal: AbortSignal },
  ): Promise<MergedHookOutcome> {
    const projectDir = config.projectDir ?? opts.agent?.session.header.cwd
    return executePoint({
      point, matchQuery, payload, session: opts.agent?.session, turn: opts.turn, signal: opts.signal,
      ...projectDir !== undefined ? { env: { CLAUDE_PROJECT_DIR: projectDir } } : {},
    })
  }

  /** Build additional model context from hook output, or return undefined when empty. */
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
    agent.ctx.effect(() => () => owned.drain(), 'hooks-claude-code: drain agent startup')
    const run = runPoint('SessionStart', source, sessionStartPayload(ctx, agent, source), { agent, signal: owned.signal })
      .then((merged) => {
        /* v8 ignore next -- agent disposal can land between the runner's final cancellation check and this continuation. */
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
          ctx.logger.warn(`hooks-claude-code: SessionStart hook failed: ${String(error)}`)
        }
      })
    owned.track(run)
    detached.track(run)
  })

  ctx.on('agent/pre-step', async ({ agent, turn, signal }, next): Promise<PreStepDecision> => {
    const source = lifecycle.takeStart(agent)
    if (source === undefined) return next()
    const merged = await runPoint('SessionStart', source, sessionStartPayload(ctx, agent, source), { agent, turn, signal })
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

  // --- UserPromptSubmit → PreStepDecision. The prompt text is the payload; no
  // matcher subject (CC ignores matchers for this event). ---
  ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next): Promise<PreStepDecision> => {
    if (messages.length === 0) return next()
    const content = messages.flatMap(message => message.content)
    const merged = await runPoint('UserPromptSubmit', '', promptPayload(ctx, agent, content), { agent, turn, signal })
    if (merged.stop) {
      agent.cancel({ kind: 'hook', reason: merged.stopReason ?? 'halted by UserPromptSubmit hook' })
      return { kind: 'reject' }
    }
    if (merged.decision === 'deny') {
      return { kind: 'reject' }
    }
    // Delegate so later listeners may still rewrite or reject, then prepend our
    // context only to a downstream enter decision.
    const downstream = await next()
    const ours = contextFrom(merged)
    if (!ours || downstream.kind !== 'enter') return downstream
    return {
      kind: 'enter',
      messages: [...downstream.messages, ours],
    }
  })

  // --- PreToolUse → PreToolDecision. Matcher subject is the tool name. ---
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const turn = lastTurn(exec.agent)
    const merged = await runPoint('PreToolUse', exec.name, preToolPayload(ctx, exec), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
    const denial = preToolDenial(merged, reason => exec.agent?.cancel({ kind: 'hook', reason }))
    if (denial !== undefined) return denial
    if (merged.decision === 'ask') return { kind: 'ask', ...merged.reason !== undefined ? { reason: merged.reason } : {} }
    return next()
  })

  // --- PostToolUse → PostToolDecision. Matcher subject is the tool name. ---
  ctx.on('tools/post-execute', async (exec, result, next): Promise<PostToolDecision> => {
    const turn = lastTurn(exec.agent)
    const merged = await runPoint('PostToolUse', exec.name, postToolPayload(ctx, exec, result), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal })
    const context = contextFrom(merged)
    if (merged.stop) {
      exec.agent?.cancel({ kind: 'hook', reason: merged.stopReason ?? 'halted by PostToolUse hook' })
      return { kind: 'block', feedback: [{ type: 'text', text: merged.reason ?? merged.stopReason ?? 'halted by PostToolUse hook' }], ...context ? { additionalContexts: [context] } : {} }
    }
    if (merged.decision === 'deny') {
      return { kind: 'block', feedback: [{ type: 'text', text: merged.reason ?? 'blocked by PostToolUse hook' }], ...context ? { additionalContexts: [context] } : {} }
    }
    // Our hooks did not block. DELEGATE so a later listener can still block/replace,
    // then fold our context onto its decision (a downstream block carries it too).
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
    const merged = await runPoint('Stop', '', stopPayload(ctx, agent, active), { agent, turn, signal })
    lifecycle.settleStop(agent, turn, signal, merged, {
      halt(reason) { agent.cancel({ kind: 'hook', reason }) },
      steer(text) { agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE })) },
      limit() { ctx.logger.warn(`hooks-claude-code: Stop continuation limit (${policy.maxStopContinuations}) reached for agent ${agent.id}, turn ${turn}`) },
    })
  })
  // SubagentStart may inject child context; SubagentStop only observes. Both
  // use the live child's workspace and the generic agent-type matcher subject.
  ctx.on('subagent/start', (info) => {
    const child = ctx.get('agents')?.get(info.id)
    if (child !== undefined) subagentChildren.set(info.runId, child)
    detached.track(runPoint('SubagentStart', SUBAGENT_TYPE, subagentPayload(ctx, 'SubagentStart', info, child), { ...child ? { agent: child } : {}, signal: detached.signal })
      .then((merged) => {
        const context = contextFrom(merged)
        if (context && child && !detached.signal.aborted) child.inject(context)
      })
      .catch((error: unknown) => {
        if (!detached.signal.aborted) ctx.logger.warn(`hooks-claude-code: SubagentStart hook failed: ${String(error)}`)
      }))
  })
  ctx.on('subagent/end', (info) => {
    const child = subagentChildren.get(info.runId) ?? ctx.get('agents')?.get(info.id)
    subagentChildren.delete(info.runId)
    detached.track(runPoint('SubagentStop', SUBAGENT_TYPE, subagentPayload(ctx, 'SubagentStop', info, child), { ...child ? { agent: child } : {}, signal: detached.signal }))
  })
}

/**
 * The `agent_type` value the bridge reports for SubagentStart/Stop. The harness
 * subagent seam carries no per-kind label, so the bridge uses Claude Code's own
 * Task-tool default — a hooks.json with a default/`*`/empty `agent_type` matcher
 * fires; a config matching a specific kind (e.g. `code-reviewer`) does not.
 */
const SUBAGENT_TYPE = 'general-purpose'

// --- Per-event stdin payloads (the CC DIALECT shape). Field names match CC's
// hook input schema; this is the part a bridge owns. ---

/** The last open turn number in the agent's log, or 0 without an agent. */
function lastTurn(agent: Agent | undefined): number {
  if (!agent) return 0
  const last = [...agent.session.events].findLast(e => e.type === 'turn/start')
  /* v8 ignore next -- agent-present callers are tool/stop extension points inside an open turn. */
  return last?.type === 'turn/start' ? last.data.turn : 0
}

/** Flatten content blocks to the text a hook payload carries (the common case). */
function blocksToText(content: ContentBlock[]): string {
  return content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('')
}

function base(ctx: Context, agent: Agent | undefined, event: string): Record<string, unknown> {
  return {
    session_id: agent?.session.header.id ?? '',
    transcript_path: agent === undefined
      ? ''
      : ctx.get('sessionPersistence')?.locate(agent.session.header)?.path ?? '',
    cwd: agent?.session.header.cwd ?? process.cwd(),
    hook_event_name: event,
  }
}

function sessionStartPayload(ctx: Context, agent: Agent, source: string): Record<string, unknown> {
  return { ...base(ctx, agent, 'SessionStart'), source }
}
function promptPayload(ctx: Context, agent: Agent, content: ContentBlock[]): Record<string, unknown> {
  return { ...base(ctx, agent, 'UserPromptSubmit'), prompt: blocksToText(content) }
}
function preToolPayload(ctx: Context, exec: ToolExecution): Record<string, unknown> {
  return { ...base(ctx, exec.agent, 'PreToolUse'), tool_name: exec.name, tool_input: exec.arguments, tool_use_id: exec.callId }
}
function postToolPayload(ctx: Context, exec: ToolExecution, result: ToolExecutionResult): Record<string, unknown> {
  return { ...base(ctx, exec.agent, 'PostToolUse'), tool_name: exec.name, tool_input: exec.arguments, tool_use_id: exec.callId, tool_response: blocksToText(result.content) }
}
function stopPayload(ctx: Context, agent: Agent, active: boolean): Record<string, unknown> {
  return { ...base(ctx, agent, 'Stop'), stop_hook_active: active }
}
/**
 * Build a SubagentStart/SubagentStop payload from the CC base (the child's
 * `session_id`/`cwd` when the child agent is available) plus the subagent-hook
 * fields. `agent_type` is the CC-default {@link SUBAGENT_TYPE}; `stop_hook_active`
 * is present on SubagentStop only (the loop-guard flag, always false).
 */
function subagentPayload(ctx: Context, event: 'SubagentStart' | 'SubagentStop', info: { id: string }, child: Agent | undefined): Record<string, unknown> {
  return {
    ...base(ctx, child, event),
    agent_id: info.id,
    agent_type: SUBAGENT_TYPE,
    ...event === 'SubagentStop' ? { stop_hook_active: false } : {},
  }
}
