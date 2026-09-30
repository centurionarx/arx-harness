/** `skill` namespace dictionaries for the dedicated tool row. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'skill'
/** The skill namespace key union. */
export type SkillKey = keyof typeof en

/** English dictionary. */
export const en = {
  'row.running': 'Loading skill',
  'row.failed': 'Skill load failed',
  'row.stopped': 'Skill load stopped',
  'row.instructions': 'Instructions',
  'menu.userOnly': 'user-only',
} satisfies Record<string, string>

/** Brazilian Portuguese dictionary. */
export const pt = {
  'row.running': 'Carregando a skill',
  'row.failed': 'Falha ao carregar a skill',
  'row.stopped': 'Carregamento da skill interrompido',
  'row.instructions': 'Instruções',
  'menu.userOnly': 'só do usuário',
} satisfies Record<SkillKey, string>
