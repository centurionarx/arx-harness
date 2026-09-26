/**
 * Ask the host's vendor CLI which models its login can reach.
 *
 * The CLI publishes no catalog a configuration surface could read without it:
 * `supportedModels()` is a method on a live query, so discovery starts one
 * vendor run with an empty prompt, reads the roster, and releases it. That
 * cost is why nothing here runs at mount or at save — only when a surface
 * asks.
 *
 * What comes back is ids and display names, one per model. Each row is
 * reported under the canonical id its alias resolves to, which is the id the
 * installed catalog sizes, `[1m]` suffix included; a row the CLI reports
 * without one keeps its alias, which states no context window and still needs
 * one before a route can serve it.
 * @module @arx-ai/arx-llm-agent-cli/discovery
 */

import { query, type ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import { claudeSpawnSpec, ManagedClaudeCodeProcess } from '@arx-ai/arx-claude-agent-sdk-process'
import type { LlmDiscoveredModel } from '@arx-ai/arx-llm'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'

import { DEFAULT_DISPOSE_GRACE_MS } from './config.ts'

/** How this module reaches the host CLI. */
export interface DiscoveryDeps {
  /** Spawn under the harness's own subprocess seam, as a request would. */
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Working directory the CLI runs in. */
  cwd: () => string
}

/**
 * List the models the host CLI's login can reach.
 *
 * @param deps - how to spawn the CLI and where to run it.
 * @returns one entry per model the roster lists, under its canonical id where
 * the CLI reports one; capacities are never disclosed.
 * @throws when the CLI is absent, not logged in, or answers no roster — the
 * failure a surface must show rather than presenting an empty list as an
 * answer.
 */
export async function discoverModels(deps: DiscoveryDeps): Promise<readonly LlmDiscoveredModel[]> {
  const run = query({
    prompt: '',
    options: {
      cwd: deps.cwd(),
      persistSession: false,
      // No tools, no skills, no MCP server: this run answers one question and
      // must not be able to act on the workspace to do it.
      skills: [],
      allowedTools: [],
      canUseTool: () => Promise.resolve({
        behavior: 'deny' as const,
        message: 'Model discovery runs no tools.',
      }),
      spawnClaudeCodeProcess: spawnOptions =>
        new ManagedClaudeCodeProcess(deps.spawn(claudeSpawnSpec(spawnOptions, DEFAULT_DISPOSE_GRACE_MS))),
    },
  })
  try {
    return canonicalModels(await run.supportedModels())
  } finally {
    // The run owns a CLI process tree whether or not the roster arrived.
    await run.interrupt().catch(() => {
      // Swallowed: the roster (or its failure) is the answer this call owes,
      // and a run that cannot be interrupted is still released by its own
      // process-tree teardown.
    })
  }
}

/**
 * The roster as one entry per model, under the id a route serves it by.
 *
 * A row's `value` is often an alias such as `opus`; `resolvedModel` is the
 * canonical id that alias runs, such as `claude-opus-5-5` or
 * `claude-opus-5-5[1m]`. Rows resolving to the same model collapse to the
 * first. The `default` row names the model the CLI recommends rather than a
 * model of its own, so a row naming the same model directly supplies the name.
 * @param rows - the CLI's roster, in its order.
 * @returns the entries in roster order, one per id.
 */
function canonicalModels(rows: readonly ModelInfo[]): LlmDiscoveredModel[] {
  const found = new Map<string, { model: LlmDiscoveredModel; recommended: boolean }>()
  for (const row of rows) {
    const id = row.resolvedModel !== undefined && row.resolvedModel.length > 0 ? row.resolvedModel : row.value
    if (found.get(id)?.recommended === false) continue
    found.set(id, {
      model: { id, ...typeof row.displayName === 'string' && row.displayName.length > 0 ? { name: row.displayName } : {} },
      recommended: row.value === 'default',
    })
  }
  return [...found.values()].map(entry => entry.model)
}
