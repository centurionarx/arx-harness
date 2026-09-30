/** `trajectory` namespace dictionaries (view tab label + toolbar strings). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'trajectory'

/** The trajectory dictionary key set (the source of truth for both locales). */
export type TrajectoryKey =
  | 'view.trajectory'
  | 'toolbar.aria'
  | 'toolbar.duration'
  | 'toolbar.useActualDuration'
  | 'toolbar.useEqualWidth'
  | 'toolbar.actualTime'
  | 'toolbar.turns'
  | 'toolbar.expandTurns'
  | 'toolbar.collapseTurns'
  | 'toolbar.calls'
  | 'toolbar.expandCalls'
  | 'toolbar.collapseCalls'
  | 'toolbar.search'
  | 'toolbar.searchPlaceholder'

declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The trajectory view tab label and toolbar strings. */
    'trajectory': TrajectoryKey
  }
}
/** English dictionary. */
export const en: Record<TrajectoryKey, string> = {
  'view.trajectory': 'Trajectory',
  'toolbar.aria': 'Trajectory toolbar',
  'toolbar.duration': 'Duration',
  'toolbar.useActualDuration': 'Use actual duration',
  'toolbar.useEqualWidth': 'Use equal-width operations',
  'toolbar.actualTime': 'Actual time',
  'toolbar.turns': 'Turns',
  'toolbar.expandTurns': 'Expand turns',
  'toolbar.collapseTurns': 'Collapse turns',
  'toolbar.calls': 'Calls',
  'toolbar.expandCalls': 'Expand calls',
  'toolbar.collapseCalls': 'Collapse calls',
  'toolbar.search': 'Search trajectory',
  'toolbar.searchPlaceholder': 'Search',
}

/** Brazilian Portuguese dictionary. */
export const pt: Record<TrajectoryKey, string> = {
  'view.trajectory': 'Trajetória',
  'toolbar.aria': 'Barra de ferramentas da trajetória',
  'toolbar.duration': 'Duração',
  'toolbar.useActualDuration': 'Usar a duração real',
  'toolbar.useEqualWidth': 'Usar operações de mesma largura',
  'toolbar.actualTime': 'Tempo real',
  'toolbar.turns': 'Turnos',
  'toolbar.expandTurns': 'Expandir os turnos',
  'toolbar.collapseTurns': 'Recolher os turnos',
  'toolbar.calls': 'Chamadas',
  'toolbar.expandCalls': 'Expandir as chamadas',
  'toolbar.collapseCalls': 'Recolher as chamadas',
  'toolbar.search': 'Pesquisar na trajetória',
  'toolbar.searchPlaceholder': 'Pesquisar',
}
