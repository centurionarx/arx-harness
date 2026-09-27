/** Machine value of the preset that requires an explicit GUI risk gate. */
export const FULL_ACCESS_PRESET = 'danger-full-access'

/**
 * Convert conventional kebab-case preset names into user-facing title case.
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export function displayPresetName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Render a permission preset under its product label.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @returns the Full access product label or the conventional display name.
 */
export function displayPermissionPreset(value: string, name: string): string {
  return value === FULL_ACCESS_PRESET ? 'Full access' : displayPresetName(name)
}

/** The Host's value for sandbox and approval settings that match no preset. */
const CUSTOM_PRESET = 'custom'

/** Locale keys naming the shipped presets, present in both permission namespaces. */
export type PresetLabelKey = 'preset.readOnly' | 'preset.workspaceWrite' | 'preset.fullAccess' | 'preset.custom'

const PRESET_LABEL_KEYS: Readonly<Partial<Record<string, PresetLabelKey>>> = {
  'read-only': 'preset.readOnly',
  'workspace-write': 'preset.workspaceWrite',
  [FULL_ACCESS_PRESET]: 'preset.fullAccess',
  [CUSTOM_PRESET]: 'preset.custom',
}

/**
 * Render a permission preset label in the active locale. Full access and
 * `custom` always use the product label. The other shipped presets use it
 * while the Host reports no operator-given name, which shows as the
 * conventional display of the value; an operator's name is shown as written.
 * @param value - preset machine value.
 * @param name - Host-reported name or an already-displayed label.
 * @param t - lookup for the preset label keys.
 * @returns the label to render.
 */
export function localizedPermissionPreset(value: string, name: string, t: (key: PresetLabelKey) => string): string {
  const key = PRESET_LABEL_KEYS[value]
  const conventional = displayPresetName(name) === displayPresetName(value)
  if (key !== undefined && (value === FULL_ACCESS_PRESET || value === CUSTOM_PRESET || conventional)) return t(key)
  return displayPresetName(name)
}
