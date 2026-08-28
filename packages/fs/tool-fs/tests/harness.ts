import { Context } from '@arx-ai/cordis'
import type { Agent } from '@arx-ai/arx-agent'
import AgentLoop from '@arx-ai/arx-agent-loop'
import { mountAgentLoopTestDependencies } from '@arx-ai/arx-agent-loop-testkit'
import LocalFileSystem from '@arx-ai/arx-fs-local'
import * as FsPolicy from '@arx-ai/arx-fs-observation-policy'
import * as ToolFs from '@arx-ai/arx-tool-fs'
import * as LlmPiAi from '@arx-ai/arx-llm-pi-ai'

/**
 * Build the real fs-tool stack for with-key e2e tests. Agents have no session
 * cwd, so `fsCwd` is their workspace; `persona` configures the deployment prompt.
 * This helper lives outside the e2e glob so imports do not register tests.
 */
export async function fsHarness(fsCwd: string, persona = ''): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona } })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LlmPiAi, { providers: { primary: { apiKeyEnv: 'PRIMARY_API_KEY' } } })
  await ctx.plugin(LocalFileSystem, { cwd: fsCwd })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs)
  return ctx
}

export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}
