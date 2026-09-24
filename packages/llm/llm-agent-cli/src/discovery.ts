/**
 * Ask the host's vendor CLI which models its login can reach.
 *
 * The CLI publishes no catalog a configuration surface could read without it:
 * `supportedModels()` is a method on a live query, so discovery starts one
 * vendor run with an empty prompt, reads the roster, and releases it. That
 * cost is why nothing here runs at mount or at save — only when a surface
 * asks.
 *
 * What comes back is ids and display names. The rows are the vendor's aliases,
 * which carry no context window and are absent from the installed catalog a
 * canonical id inherits one from, so a discovered model still states its own:
 * automatic compaction refuses a route whose adapter advertises no capacity.
 * @module @arx-ai/arx-llm-agent-cli/discovery
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
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
 * @returns the vendor's own roster, ids first; capacities are never disclosed.
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
    const rows = await run.supportedModels()
    return rows.map((row): LlmDiscoveredModel => ({
      id: row.value,
      ...typeof row.displayName === 'string' && row.displayName.length > 0 ? { name: row.displayName } : {},
    }))
  } finally {
    // The run owns a CLI process tree whether or not the roster arrived.
    await run.interrupt().catch(() => {
      // Swallowed: the roster (or its failure) is the answer this call owes,
      // and a run that cannot be interrupted is still released by its own
      // process-tree teardown.
    })
  }
}
