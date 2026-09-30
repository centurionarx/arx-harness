/** Locale bundles for the plugin configuration section and its plugin cards. */

/** Locale keys these surfaces render. */
export type PluginsSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'configurableTab' | 'empty'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse'
  | 'save' | 'saving' | 'discard' | 'unsaved' | 'saveFailed' | 'invalidNumber'
  | 'bashTitle' | 'bashDescription' | 'bashTimeoutMs' | 'bashTimeoutMsHint'
  | 'bashMaxOutputBytes' | 'bashMaxOutputBytesHint'
  | 'agentLoopTitle' | 'agentLoopDescription' | 'agentLoopMaxParallel' | 'agentLoopMaxParallelHint'

/** English copy. */
export const en: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Plugins',
  title: 'Plugins',
  intro: 'Configure and inspect the plugins installed in this deployment.',
  tabs: 'Plugin views',
  configurableTab: 'Plugin configuration',
  empty: 'This deployment exposes no plugin settings.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  bashTitle: 'Shell',
  bashDescription: 'Limits every command the agent runs.',
  bashTimeoutMs: 'Command timeout (ms)',
  bashTimeoutMsHint: 'How long one command may run before it is terminated.',
  bashMaxOutputBytes: 'Output cap per stream (bytes)',
  bashMaxOutputBytesHint: 'Output beyond this spills to a temporary file rather than being lost.',
  agentLoopTitle: 'Agent loop',
  agentLoopDescription: 'How the agent dispatches tool calls.',
  agentLoopMaxParallel: 'Parallel tool calls',
  agentLoopMaxParallelHint: 'Upper bound on parallel-safe calls running at once within one step.',
}

/** Brazilian Portuguese copy. */
export const pt: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Plugins',
  title: 'Plugins',
  intro: 'Configure e inspecione os plugins instalados nesta implantação.',
  tabs: 'Visões dos plugins',
  configurableTab: 'Configuração dos plugins',
  empty: 'Esta implantação não expõe configurações de plugins.',
  overridden: 'Sobrescrito',
  reset: 'Restaurar o padrão',
  readOnly: 'Esta implantação armazena as configurações como somente leitura.',
  expand: 'Mostrar as configurações',
  collapse: 'Ocultar as configurações',
  save: 'Salvar',
  saving: 'Salvando…',
  discard: 'Descartar',
  unsaved: 'Não salvo',
  saveFailed: 'A implantação não aceitou estes valores; eles ficaram para você corrigir.',
  invalidNumber: 'Digite um número ou deixe em branco para usar o padrão.',
  bashTitle: 'Shell',
  bashDescription: 'Limita cada comando que o agente executa.',
  bashTimeoutMs: 'Tempo limite do comando (ms)',
  bashTimeoutMsHint: 'Quanto tempo um comando pode rodar antes de ser encerrado.',
  bashMaxOutputBytes: 'Limite de saída por fluxo (bytes)',
  bashMaxOutputBytesHint: 'A saída além disso vai para um arquivo temporário, em vez de ser perdida.',
  agentLoopTitle: 'Loop do agente',
  agentLoopDescription: 'Como o agente despacha as chamadas de ferramenta.',
  agentLoopMaxParallel: 'Chamadas de ferramenta em paralelo',
  agentLoopMaxParallelHint: 'Limite de chamadas seguras para paralelismo rodando ao mesmo tempo em uma etapa.',
}
