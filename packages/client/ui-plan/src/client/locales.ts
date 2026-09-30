/** `plan` namespace dictionaries (the composer plan chip's copy). */
/** The plan namespace key union. */
export type PlanKey = keyof typeof en

/** English dictionary. */
export const en = {
  'chip.on.aria': 'Plan mode on, press to turn off',
  'chip.on.title': 'Plan mode on — click to turn off (/plan off)',
  'chip.off.aria': 'Plan mode off, press to turn on',
  'chip.off.title': 'Plan mode off — click to turn on (/plan)',
} satisfies Record<string, string>

/** Brazilian Portuguese dictionary. */
export const pt = {
  'chip.on.aria': 'Modo de plano ativado; pressione para desativar',
  'chip.on.title': 'Modo de plano ativado — clique para desativar (/plan off)',
  'chip.off.aria': 'Modo de plano desativado; pressione para ativar',
  'chip.off.title': 'Modo de plano desativado — clique para ativar (/plan)',
} satisfies Record<PlanKey, string>
