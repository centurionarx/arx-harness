/** `command` namespace dictionaries (the popupSelect shell's copy). */
/** The command namespace key union. */
export type CommandKey = keyof typeof en

/** English dictionary. */
export const en = {
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
  'notice.imagesUnsupported': '/{command} does not accept image attachments; remove them first',
} satisfies Record<string, string>

/** Brazilian Portuguese dictionary. */
export const pt = {
  'search.placeholder': 'Pesquisar…',
  'search.aria': 'Filtrar as opções',
  'status.loading': 'Carregando as opções…',
  'status.applying': 'Aplicando…',
  'status.empty': 'Nenhuma opção',
  'overlay.aria': 'Opções de /{command}',
  'listbox.aria': 'Resultados de /{command}',
  'notice.imagesUnsupported': '/{command} não aceita imagens anexadas; remova-as primeiro',
} satisfies Record<CommandKey, string>
