/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'
/** English dictionary (same key set). */
export const en = {
  'produced.label': 'Produced',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.open': 'Open {name}',
  'produced.showInFolder': 'Show in folder',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof en

/** Brazilian Portuguese dictionary. */
export const pt = {
  'produced.label': 'Produzidos',
  'produced.moreOne': '+ 1 arquivo',
  'produced.more': '+ {count} arquivos',
  'produced.open': 'Abrir {name}',
  'produced.showInFolder': 'Mostrar na pasta',
} satisfies Record<DeliverablesKey, string>
