/** Shell chrome and General-nav dictionaries; feature rows own their copy. */
/** The settings namespace key union. */
export type SettingsKey = keyof typeof en

/** English dictionary. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'openDocument.copy': 'Copy path',
  'openDocument.copied': 'Copied',
  'general.nav': 'General',
} satisfies Record<string, string>

/** Brazilian Portuguese dictionary. */
export const pt = {
  'trigger': 'Configurações',
  'title': 'Configurações',
  'close': 'Fechar',
  'openDocument': 'Abrir o arquivo de configuração',
  'openDocument.error': 'Não foi possível abrir o arquivo de configuração',
  'openDocument.copy': 'Copiar o caminho',
  'openDocument.copied': 'Copiado',
  'general.nav': 'Geral',
} satisfies Record<SettingsKey, string>
