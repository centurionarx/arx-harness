/**
 * Labels for the reasoning-effort ids the adapters share.
 *
 * The Host decides which levels a model offers and reports each one with a
 * name, but it renders one catalog for every viewer and has no viewer locale.
 * The ids below are the common vocabulary of the model routes (the pi-ai
 * thinking levels and the vendor CLI effort levels), so the client labels
 * them in the active locale. An id outside this set keeps the name the Host
 * reported.
 */
import type { TranslateNS } from '@arx-ai/arx-client-ui-slots'
import type { ModelKey } from './locales.ts'

const EFFORT_LEVEL_KEYS: Readonly<Partial<Record<string, ModelKey>>> = {
  off: 'effort.level.off',
  minimal: 'effort.level.minimal',
  low: 'effort.level.low',
  medium: 'effort.level.medium',
  high: 'effort.level.high',
  xhigh: 'effort.level.xhigh',
  max: 'effort.level.max',
}

/**
 * Label one reasoning-effort level for the active locale.
 * @param id - effort id as the Host reports it.
 * @param hostName - the Host's display name for that id, when the model lists it.
 * @param t - the `model` namespace translate function.
 * @returns the locale label for a shared id, else the Host name, else the id itself.
 */
export function effortLevelLabel(id: string, hostName: string | undefined, t: TranslateNS<'model'>): string {
  const key = EFFORT_LEVEL_KEYS[id]
  return key === undefined ? hostName ?? id : t(key)
}
