/** `goal` namespace dictionaries. */
/** The goal namespace key union. */
export type GoalKey = keyof typeof en

/** English dictionary. */
export const en = {
  'phase.active': 'Ongoing Goal',
  'phase.paused': 'Paused Goal',
  'phase.blocked': 'Blocked Goal',
  'objective.aria': 'Goal objective',
  'commandInput.aria': 'Command input',
  'action.save': 'Save goal',
  'action.cancel': 'Cancel edit',
  'action.pause': 'Pause goal',
  'action.resume': 'Resume goal',
  'action.edit': 'Edit goal',
  'action.clear': 'Clear goal',
} satisfies Record<string, string>

/** Brazilian Portuguese dictionary. */
export const pt = {
  'phase.active': 'Meta em andamento',
  'phase.paused': 'Meta pausada',
  'phase.blocked': 'Meta bloqueada',
  'objective.aria': 'Objetivo da meta',
  'commandInput.aria': 'Entrada de comando',
  'action.save': 'Salvar a meta',
  'action.cancel': 'Cancelar a edição',
  'action.pause': 'Pausar a meta',
  'action.resume': 'Retomar a meta',
  'action.edit': 'Editar a meta',
  'action.clear': 'Limpar a meta',
} satisfies Record<GoalKey, string>
