/**
 * The vendor-CLI routes this adapter offers a deployment before any of them is
 * configured.
 *
 * A configuration surface can only offer what some adapter declares, and this
 * adapter's routes are not discovered: the CLI publishes no provider catalog,
 * so the roster is the product's own. It is not a tunable — a deployment adds
 * a route by naming it in the settings section, which joins the directory
 * beside these, and removes one by emptying that section.
 * @module @arx-ai/arx-llm-agent-cli/presets
 */

/** One route this package offers by name, before any deployment configures it. */
export interface AgentCliPreset {
  /** Route id requests name, and the key its settings profile takes. */
  readonly provider: string
  /** Human-readable provider name for selectors, before a profile renames it. */
  readonly displayName: string
}

/**
 * Routes offered by name. No models ship with them: `contextWindow` is
 * required on every model and the CLI discloses none, so a deployment states
 * the roster its subscription actually serves.
 */
export const AGENT_CLI_PRESETS: readonly AgentCliPreset[] = [
  { provider: 'claude-subscription', displayName: 'Claude (subscription)' },
]

/** Route ids this package offers by name. */
export const AGENT_CLI_PRESET_IDS: ReadonlySet<string> = new Set(
  AGENT_CLI_PRESETS.map(preset => preset.provider),
)
