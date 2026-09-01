/** `reference` namespace dictionaries for the unified `@` source. */

import type {} from '@arx-ai/arx-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'reference'
/** The reference namespace key union. */
export type ReferenceKey = keyof typeof en

declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The unified `@` reference menu's copy. */
    reference: ReferenceKey
  }
}

/** English dictionary. */
export const en = {
  'section.files': 'Files & folders',
  'section.sessions': 'Session conversations',
  'candidate.file': 'File',
  'candidate.folder': 'Folder',
  'candidate.session': 'Session',
  'candidate.noCwd': '(no cwd)',
} satisfies Record<string, string>
