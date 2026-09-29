/** `layout` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'layout'

/** English dictionary. */
export const en = {
  'resize.sidebar': 'Resize sidebar',
  'resize.details': 'Resize details panel',
} satisfies Record<string, string>

/** The layout namespace key union. */
export type LayoutKey = keyof typeof en

/** Brazilian Portuguese dictionary. */
export const pt = {
  'resize.sidebar': 'Redimensionar a barra lateral',
  'resize.details': 'Redimensionar o painel de detalhes',
} satisfies Record<LayoutKey, string>
