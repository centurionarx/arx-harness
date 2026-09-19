import type { Branded } from '@arx-ai/arx-brand'

/** Stable Loader-tree identity of one configured plugin entry. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Lifecycle state of an entry's root Fiber, or null when it has no live root Fiber. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/** One non-group Loader entry exposed to trusted clients. */
export interface PluginInventoryEntry {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestor groups. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
}

/** Effective enablement of one preset composition row. */
export type PresetPluginEnablement = boolean | 'conditional'

/** One flattened plugin row in an agent preset composition. */
export interface AgentPresetPluginRow {
  readonly entryId: string | null
  readonly moduleName: string
  readonly enabled: PresetPluginEnablement
  readonly condition?: string
  readonly fiberPhase: PluginFiberPhase
}

/** One preset identity and its safe, config-free plugin composition. */
export interface AgentPresetPluginGroup {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly name?: string
  readonly isDefault: boolean
  readonly broken?: string
  readonly rows: readonly AgentPresetPluginRow[]
}

/** Point-in-time inventory returned by the plugin inventory Remote. */
export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
  /** Present only when an agent-preset roster is composed. */
  readonly agentPresets?: readonly AgentPresetPluginGroup[]
}
