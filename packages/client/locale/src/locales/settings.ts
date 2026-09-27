/** `settings.locale` namespace dictionaries (the Language row's copy). */
/** The settings.locale namespace key union. */
export type SettingsLocaleKey = keyof typeof en

/** English dictionary. */
export const en = {
  'language.title': 'Language',
} satisfies Record<string, string>

/** Brazilian Portuguese dictionary. */
export const pt = {
  'language.title': 'Idioma',
} satisfies Record<SettingsLocaleKey, string>
