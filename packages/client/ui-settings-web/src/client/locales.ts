/** Copy dictionaries for the Web search settings section. */

/** English strings (the key-set source of truth). */
export const en = {
  nav: 'Web search',
  title: 'Web search',
  intro: 'Choose which provider answers web searches and store its API key.',
  selection: 'Search provider',
  selectionAuto: 'Automatic — the one usable provider',
  selectionEffective: 'Searches run through {provider}.',
  selectionSaved: 'Search provider saved.',
  failureConfiguredMissing: 'The pinned provider is not mounted in this deployment.',
  failureConfiguredUnavailable: 'The pinned provider has no usable key.',
  failureUnavailable: 'No provider has a usable key; searches fail until one does.',
  failureAmbiguous: 'More than one provider is usable; pin one.',
  available: 'Usable',
  unavailable: 'Not usable',
  credentialConfigured: 'API key configured',
  credentialMissing: 'API key missing',
  noAddress: 'Configured by the composition; nothing to edit here.',
  keyLabel: 'API key for {provider}',
  keyHint: 'Stored outside the settings document. Leave blank to keep the current key.',
  save: 'Save',
  saving: 'Saving…',
  remove: 'Remove key',
  savedKey: 'Saved the {provider} key.',
  removedKey: 'Removed the {provider} key.',
  readOnly: 'The settings document is read-only in this deployment.',
  loadFailed: 'Loading the search providers failed',
  credentialsUnavailable: 'Key state is unavailable: {error}',
} as const

/** Dictionary key. */
export type WebKey = keyof typeof en
