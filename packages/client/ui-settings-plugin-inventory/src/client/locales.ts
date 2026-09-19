/** Copy dictionaries for the plugin inventory Settings section. */
/** Plugin inventory locale key union. */
export type PluginInventoryLocaleKey = keyof typeof en

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'Plugin list',
  loading: 'Reading plugins…',
  error: 'Plugins are temporarily unavailable.',
  retry: 'Retry',
  search: 'Search plugins',
  catalog: 'Plugin list',
  scope: 'Composition',
  globalScope: 'Global host plugins',
  systemPreset: 'Shipped preset',
  userPreset: 'User preset',
  defaultPreset: 'Default',
  brokenPreset: 'This preset composition cannot be read.',
  empty: 'No plugins are available.',
  emptySearch: 'No matching plugins.',
  enabledTag: 'Enabled',
  disabledTag: 'Disabled',
  conditionalTag: 'Conditional',
  configuration: 'Configuration',
  condition: 'Condition',
  cordis: 'Cordis status',
  unobserved: 'Not mounted',
  pending: 'Waiting for dependencies',
  loadingPhase: 'Loading',
  active: 'Mounted',
  failed: 'Mount failed',
  unloading: 'Unloading',
} satisfies Record<string, string>
