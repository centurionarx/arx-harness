/** English and Brazilian Portuguese copy for the human-only GitHub view. */
export const en = {
  title: 'GitHub', repositoriesTitle: 'GitHub repositories', refreshRepositories: 'Refresh repositories', refresh: 'Refresh', loading: 'Loading GitHub metadata…',
  cold: 'Refresh to read GitHub account metadata.', stale: 'Metadata changed. Refresh before using GitHub.',
  unconfigured: 'Not configured. The operator must choose credential storage and isolation before a PAT can be accepted.',
  disconnected: 'Disconnected', connected: 'Connected', authorize: 'Connect with PAT',
  readonly: 'Read-only credential reference. Authorization is unavailable here.',
  workspace: 'Workspace', repository: 'Repo', choose: 'Choose explicitly', more: 'Load more',
  pair: 'View-only association for the current selection; no saved binding, clone or Git writes.',
  private: 'Private', public: 'Public', branch: 'Default branch', none: 'None',
  noRepositories: 'No repositories on this page.', authTitle: 'GitHub personal access token',
  warning: 'Record mode stores the PAT on the server. It is not automatically model-visible, but host tools running under the same UID may read the credential storage. Choose operator isolation before submitting.',
  pat: 'Personal access token', submit: 'Submit', cancel: 'Cancel',
  authorized: 'Authorization finished. Refresh to verify the account.', failed: 'Authorization failed. Cancel and try again.',
  cancelled: 'Authorization cancelled.', expired: 'Authorization expired. Cancel and try again.',
  starting: 'Starting authorization…', waiting: 'Waiting for authorization…',
  readError: 'GitHub metadata could not be read. Refresh to try again.', authError: 'Authorization request failed. Cancel and try again.',
}
/** Dictionary key set supplied by the locale registration. */
export type GithubKey = keyof typeof en
/** Brazilian Portuguese copy. */
export const pt: Record<GithubKey, string> = {
  title: 'GitHub', repositoriesTitle: 'Repositórios do GitHub', refreshRepositories: 'Atualizar repositórios', refresh: 'Atualizar', loading: 'Carregando metadados do GitHub…',
  cold: 'Atualize para consultar os metadados da conta do GitHub.', stale: 'Os metadados mudaram. Atualize antes de usar o GitHub.',
  unconfigured: 'Não configurado. O operador deve escolher armazenamento e isolamento de credenciais antes de aceitar um PAT.',
  disconnected: 'Desconectado', connected: 'Conectado', authorize: 'Conectar com PAT',
  readonly: 'Referência de credencial somente leitura. A autorização não está disponível aqui.',
  workspace: 'Workspace', repository: 'Repo', choose: 'Escolha explicitamente', more: 'Carregar mais',
  pair: 'Associação somente visual para a seleção atual; sem vínculo salvo, clone ou gravações Git.',
  private: 'Privado', public: 'Público', branch: 'Branch padrão', none: 'Nenhuma',
  noRepositories: 'Nenhum repositório nesta página.', authTitle: 'Token de acesso pessoal do GitHub',
  warning: 'O modo de registro armazena o PAT no servidor. Ele não fica automaticamente visível ao modelo, mas ferramentas do host executadas com o mesmo UID podem ler as credenciais. Escolha o isolamento com o operador antes de enviar.',
  pat: 'Token de acesso pessoal', submit: 'Enviar', cancel: 'Cancelar',
  authorized: 'Autorização concluída. Atualize para verificar a conta.', failed: 'Falha na autorização. Cancele e tente novamente.',
  cancelled: 'Autorização cancelada.', expired: 'Autorização expirada. Cancele e tente novamente.',
  starting: 'Iniciando autorização…', waiting: 'Aguardando autorização…',
  readError: 'Não foi possível consultar os metadados do GitHub. Atualize para tentar novamente.', authError: 'Falha na solicitação de autorização. Cancele e tente novamente.',
}
