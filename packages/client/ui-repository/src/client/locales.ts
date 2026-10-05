/** Repository copy follows the locale plugin's English and PT-BR namespaces. */
export const en = {
  title: 'Repository', workspace: 'Workspace', choose: 'Select a workspace', refresh: 'Refresh', retry: 'Retry',
  loading: 'Loading repository…', empty: 'No changes', noWorkspace: 'No registered workspaces',
  notRepository: 'This workspace has no Git repository', stale: 'Repository data is stale. Refresh to continue.',
  chooseNotice: 'Select a workspace to inspect its repository.', detached: 'Detached HEAD', unborn: 'No commits yet',
  staged: 'Prepared', unstaged: 'Modified', untracked: 'New', unmerged: 'Conflicts',
  unsupported: 'Conflict and submodule comparisons are not supported',
  binary: 'Binary file — no textual comparison', noDiff: 'No textual differences',
  close: 'Close', diff: 'Read-only comparison', expand: 'Expand sidebar to inspect the repository',
  aheadBehind: '{ahead} ahead · {behind} behind', workspaceLoading: 'Loading workspaces…',
} satisfies Record<string, string>
/** Keys of the repository dictionary. */
export type RepositoryKey = keyof typeof en
/** Brazilian Portuguese user-facing copy. */
export const pt = {
  title: 'Repositório', workspace: 'Workspace', choose: 'Selecione um workspace', refresh: 'Atualizar', retry: 'Tentar novamente',
  loading: 'Carregando repositório…', empty: 'Nenhuma alteração', noWorkspace: 'Nenhum workspace registrado',
  notRepository: 'Este workspace não tem um repositório Git', stale: 'Dados desatualizados. Atualize para continuar.',
  chooseNotice: 'Selecione um workspace para inspecionar o repositório.', detached: 'HEAD destacado', unborn: 'Nenhum commit ainda',
  staged: 'Preparados', unstaged: 'Modificados', untracked: 'Novos', unmerged: 'Conflitos',
  unsupported: 'Comparações de conflitos e submódulos não são suportadas',
  binary: 'Arquivo binário — sem comparação textual', noDiff: 'Nenhuma diferença textual',
  close: 'Fechar', diff: 'Comparação somente leitura', expand: 'Expandir barra lateral para inspecionar o repositório',
  aheadBehind: '{ahead} à frente · {behind} atrás', workspaceLoading: 'Carregando workspaces…',
} satisfies Record<RepositoryKey, string>
