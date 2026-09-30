/** Turn outline copy owned by this plugin. */
export const en = {
  total: 'Indexed turns: {total}', older: 'Older turns', newest: 'Newest turns',
  loadingPage: 'Loading turn index…', failedPage: 'Turn index could not be loaded. Change the search or return to the newest turns to retry.',
  title: 'Turn outline', search: 'Search turns', empty: 'No turns yet.', unavailable: 'Turn outline is unavailable.',
  turn: 'Turn {turn}', untitled: 'No user text', open: 'Open in conversation', loading: 'Loading history…',
  failed: 'This turn could not be opened. Try loading older history and retry.',
  running: 'Running', completed: 'Completed', aborted: 'Cancelled', blocked: 'Blocked', error: 'Failed',
  interrupted: 'Interrupted', 'max-tokens': 'Output limit reached',
}
/** Locale keys used by the outline. */
export type OutlineKey = keyof typeof en
/** Brazilian Portuguese outline copy. */
export const pt = {
  total: 'Turnos indexados: {total}', older: 'Turnos anteriores', newest: 'Turnos mais recentes',
  loadingPage: 'Carregando o índice de turnos…', failedPage: 'Não foi possível carregar o índice de turnos. Mude a pesquisa ou volte aos turnos mais recentes para tentar de novo.',
  title: 'Sumário dos turnos', search: 'Pesquisar turnos', empty: 'Nenhum turno ainda.', unavailable: 'O sumário dos turnos está indisponível.',
  turn: 'Turno {turn}', untitled: 'Sem texto do usuário', open: 'Abrir na conversa', loading: 'Carregando o histórico…',
  failed: 'Não foi possível abrir este turno. Carregue o histórico mais antigo e tente de novo.',
  running: 'Executando', completed: 'Concluído', aborted: 'Cancelado', blocked: 'Bloqueado', error: 'Falhou',
  interrupted: 'Interrompido', 'max-tokens': 'Limite de saída atingido',
} satisfies Record<OutlineKey, string>
