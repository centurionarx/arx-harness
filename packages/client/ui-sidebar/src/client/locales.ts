/** `sidebar` namespace dictionaries: shell controls (brand row, New Session, fold toggle). */
/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof en

/** English dictionary. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
} satisfies Record<string, string>

/** Brazilian Portuguese dictionary. */
export const pt = {
  'session.new': 'Nova sessão',
  'session.new.label': 'Nova sessão',
  'toggle.open': 'Abrir a barra lateral',
  'toggle.collapse': 'Recolher a barra lateral',
} satisfies Record<SidebarKey, string>
