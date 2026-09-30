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

/** Brazilian Portuguese strings. */
export const pt = {
  nav: 'Busca na web',
  title: 'Busca na web',
  intro: 'Escolha qual provedor responde às buscas na web e guarde a chave de API dele.',
  selection: 'Provedor de busca',
  selectionAuto: 'Automático — o único provedor utilizável',
  selectionEffective: 'As buscas passam por {provider}.',
  selectionSaved: 'Provedor de busca salvo.',
  failureConfiguredMissing: 'O provedor fixado não está montado nesta implantação.',
  failureConfiguredUnavailable: 'O provedor fixado não tem uma chave utilizável.',
  failureUnavailable: 'Nenhum provedor tem uma chave utilizável; as buscas falham até que um tenha.',
  failureAmbiguous: 'Mais de um provedor é utilizável; fixe um.',
  available: 'Utilizável',
  unavailable: 'Não utilizável',
  credentialConfigured: 'Chave de API configurada',
  credentialMissing: 'Chave de API ausente',
  noAddress: 'Configurado pela composição; não há nada para editar aqui.',
  keyLabel: 'Chave de API de {provider}',
  keyHint: 'Armazenada fora do documento de configurações. Deixe em branco para manter a chave atual.',
  save: 'Salvar',
  saving: 'Salvando…',
  remove: 'Remover a chave',
  savedKey: 'Chave de {provider} salva.',
  removedKey: 'Chave de {provider} removida.',
  readOnly: 'O documento de configurações é somente leitura nesta implantação.',
  loadFailed: 'Falha ao carregar os provedores de busca',
  credentialsUnavailable: 'O estado das chaves está indisponível: {error}',
} satisfies Record<WebKey, string>
