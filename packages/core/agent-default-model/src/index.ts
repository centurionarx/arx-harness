/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @arx-ai/arx-agent-default-model
 */

import { Context, Service } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import type { ModelSelection } from '@arx-ai/arx-agent'
import { ReasoningEffortId } from '@arx-ai/arx-llm'
import { installSettingsSection, settingsNamespace } from '@arx-ai/arx-settings'

declare module '@arx-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/** Settings namespace carrying the default model selection for future Agents. */
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = settingsNamespace('agent-default-model')

/**
 * Stored and composed default model selection.
 *
 * A deployment that ships no default leaves `provider` and `model` unset, and
 * every consumer then has no selection to seed with until the user picks one.
 * Both must be present together: half a selection names no reachable route.
 */
export interface AgentDefaultModelSettings {
  /** Registered provider route. */
  provider?: string
  /** Provider-owned model id. */
  model?: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
}

/** Schema of the default Agent model settings section. */
export const AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA: z<AgentDefaultModelSettings> = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
})

/** Composition entry for the default model selection. */
export interface Config {
  /** Registered provider route; absent ships no default. */
  provider?: string
  /** Provider-owned model id; absent ships no default. */
  model?: string
}

/**
 * Project stored settings onto the Agent-facing selection type.
 * @param settings - the current stored or composed section.
 * @returns the selection, or undefined when the deployment ships none.
 */
function selection(settings: AgentDefaultModelSettings): ModelSelection | undefined {
  if (settings.provider === undefined || settings.model === undefined) return undefined
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
  }
}

/**
 * Owns the default model selection independently of any Host or transport.
 * The composition entry remains usable without a settings provider; when one
 * is mounted, its user layer is read live.
 */
export class AgentDefaultModelConfig extends Service {
  static Config: z<Config> = z.object({
    provider: z.string(),
    model: z.string(),
  })

  private source: () => AgentDefaultModelSettings

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentDefaultModel')
    const entry: AgentDefaultModelSettings = {
      ...config.provider === undefined ? {} : { provider: config.provider },
      ...config.model === undefined ? {} : { model: config.model },
    }
    this.source = () => entry
    installSettingsSection(ctx, AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, AGENT_DEFAULT_MODEL_SETTINGS_SCHEMA, entry, {
      setSource: (current) => { this.source = current },
      // Every consumer reads through currentSelection(), so no registration-level fact
      // needs rebuilding when the settings document changes.
      onChange: () => {},
    })
  }

  /**
   * Read the current default model selection.
   * @returns a detached selection, or undefined when the deployment ships none and the user has picked none.
   */
  currentSelection(): ModelSelection | undefined {
    return selection(this.source())
  }

  /**
   * Save the complete default model selection. A deployment without a settings
   * provider keeps its composition entry.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional settings write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    await this.ctx.get('settings')?.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      provider: next.provider,
      model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    })
  }
}

export default AgentDefaultModelConfig
