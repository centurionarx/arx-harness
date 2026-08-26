/**
 * The `LlmAdapter` that drives a subscription-authenticated vendor CLI as an
 * ordinary model route.
 *
 * @module @centurionarx/cxh-llm-agent-cli/adapter
 */

import { Readable } from 'node:stream'

import { type Options, query } from '@anthropic-ai/claude-agent-sdk'
import { claudeSpawnSpec, ManagedClaudeCodeProcess } from '@centurionarx/cxh-claude-agent-sdk-process'
import {
  LlmAdapter,
  LlmError,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@centurionarx/cxh-llm'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@centurionarx/cxh-subprocess'

import type { ResolvedRoute } from './config.ts'
import { toVendorMessages, renderTranscript } from './prompt.ts'
import { SessionAffinity } from './session.ts'
import { translate } from './stream.ts'
import { createToolServer, MCP_SERVER_NAME, toolAlias } from './tools.ts'

/** What the adapter needs from the composition it runs in. */
export interface AgentCliAdapterSpec {
  /** Routes this adapter serves, as configuration resolved them. */
  readonly routes: () => ReadonlyMap<string, ResolvedRoute>
  /** Process owner for the CLI the SDK spawns. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Workspace the CLI runs in. */
  readonly cwd: () => string
}

/** The vendor CLI's own tools, refused so only harness tools reach the model. */
const VENDOR_TOOLS = [
  'Bash', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'Read', 'Task', 'TodoWrite', 'WebFetch', 'WebSearch', 'Write',
  'AskUserQuestion', 'ExitPlanMode', 'Skill',
] as const

/**
 * Drive a vendor CLI as a model route.
 *
 * The CLI is an agent with a tool loop of its own. Three settings turn it into
 * one model call: the harness system prompt replaces its own, its built-in
 * tools are refused by name while the harness tools arrive over an in-process
 * MCP server, and every permission request is denied so no tool it asks for
 * can run outside the harness. The turn cap stops it after one assistant turn,
 * which is exactly `stream()`'s contract.
 */
export class AgentCliAdapter extends LlmAdapter {
  private readonly affinity = new SessionAffinity()

  constructor(private readonly spec: AgentCliAdapterSpec) {
    super()
  }

  /** Resolve one configured route or fail naming it. */
  private route(provider: string): ResolvedRoute {
    const route = this.spec.routes().get(provider)
    if (route === undefined) {
      throw new LlmError(`llm-agent-cli: provider "${provider}" is not configured`, 'UNKNOWN_PROVIDER')
    }
    return route
  }

  /**
   * Describe one configured route.
   * @param provider - a route this adapter registered.
   * @returns display metadata for that route.
   */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.spec.routes().get(provider)?.displayName ?? provider }
  }

  /**
   * List the models configuration gave this route.
   * @param provider - a route this adapter registered.
   * @returns the configured models in configuration order.
   */
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const route = this.spec.routes().get(provider)
    if (route === undefined) return Promise.resolve([])
    return Promise.resolve([...route.models.values()].map(model => ({
      provider,
      id: model.id,
      name: model.name ?? model.id,
    })))
  }

  /**
   * Resolve one exact model's capacity and call defaults.
   * @param provider - a route this adapter registered.
   * @param model - exact model id.
   * @returns identity plus the configured context capacity.
   */
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const configured = this.route(provider).models.get(model)
    if (configured === undefined) {
      throw new LlmError(`llm-agent-cli: provider "${provider}" serves no model "${model}"`, 'UNKNOWN_MODEL')
    }
    return Promise.resolve({
      provider,
      id: model,
      name: configured.name ?? model,
      context: { contextWindow: configured.contextWindow },
      ...configured.maxTokens === undefined ? {} : { defaultMaxTokens: configured.maxTokens },
    })
  }

  /**
   * Build the fixed SDK options that make one CLI run behave as one model call.
   * @param options - the assembled harness request.
   * @param route - the resolved route serving it.
   * @param resume - vendor session to continue, when affinity holds one.
   * @param capture - receives the managed child the SDK spawns.
   * @returns options for one `query()` call.
   */
  private queryOptions(
    options: GenerateOptions,
    route: ResolvedRoute,
    resume: string | undefined,
    capture: (child: SubprocessHandle) => void,
  ): Options {
    const tools = options.tools ?? []
    return {
      cwd: this.spec.cwd(),
      persistSession: false,
      includePartialMessages: true,
      maxTurns: 1,
      model: options.model,
      ...options.system === undefined ? {} : { systemPrompt: options.system },
      ...resume === undefined ? {} : { resume },
      // Omitting `skills` is not "skills off": the SDK documents that the
      // CLI's own defaults still apply, so the host's skill directories would
      // reach the model through a tool the harness never registered and never
      // logs. Skills reach a harness model through `ctx.skills`, whose loading
      // the session records.
      skills: [],
      mcpServers: { [MCP_SERVER_NAME]: { type: 'sdk', name: MCP_SERVER_NAME, instance: createToolServer(tools) } },
      allowedTools: tools.map(tool => toolAlias(tool.name)),
      disallowedTools: [...VENDOR_TOOLS],
      // The harness runs every tool itself. Denying here keeps a tool the
      // model asked for from executing inside the CLI, where the harness
      // would neither see the call nor log its result.
      canUseTool: () => Promise.resolve({
        behavior: 'deny' as const,
        message: 'This adapter returns tool calls to the harness; the CLI never executes them.',
      }),
      spawnClaudeCodeProcess: (spawnOptions) => {
        const child = this.spec.spawn(claudeSpawnSpec(spawnOptions, route.disposeGraceMs))
        capture(child)
        return new ManagedClaudeCodeProcess(child)
      },
    }
  }

  /**
   * Stream one model call through the vendor CLI.
   * @param options - the fully assembled harness request.
   * @returns the harness chunk stream for that call.
   */
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const route = this.route(options.provider)
    const sessionId = options.sessionId as string | undefined
    const continuation = this.affinity.resolve(sessionId, options.messages)
    const controller = new AbortController()
    options.signal?.addEventListener('abort', () => { controller.abort() }, { once: true })

    let child: SubprocessHandle | undefined
    const run = query({
      prompt: continuation.resume === undefined
        ? renderTranscript(continuation.deliver)
        : Readable.from(toVendorMessages(continuation.deliver)) as never,
      options: {
        ...this.queryOptions(options, route, continuation.resume, (handle) => { child = handle }),
        abortController: controller,
      },
    })

    let vendorSessionId: string | undefined
    try {
      yield* translate((async function* () {
        for await (const message of run) {
          const carried = message as { session_id?: string }
          if (carried.session_id !== undefined) vendorSessionId = carried.session_id
          yield message
        }
      })())
      if (vendorSessionId !== undefined) this.affinity.commit(sessionId, vendorSessionId, continuation.digests)
    } finally {
      // The SDK owns protocol shutdown; the subprocess handle owns the tree.
      await run.interrupt().catch(() => {})
      child?.terminate()
    }
  }
}
