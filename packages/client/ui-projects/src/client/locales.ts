/** Copy owned by the project workspace. */
export const en = {
  title: 'Projects', close: 'Close', refresh: 'Refresh', loading: 'Loading…',
  empty: 'Create a project to organize plans, prompts and execution evidence.',
  name: 'Project name', workspace: 'Workspace', create: 'Create project',
  select: 'Choose a project', plan: 'Plan', summary: 'Plan summary',
  items: 'Task title', criteria: 'Acceptance criteria (one per line)',
  addTask: 'Add task', removeTask: 'Remove task', dependencies: 'Depends on',
  savePlan: 'Save new plan revision', approve: 'Approve this revision',
  saveBeforeApproval: 'Save your changes as a new revision before approving this plan.',
  approved: 'Approved revision', revision: 'Revision', prompts: 'Prompt library',
  promptName: 'Prompt name', template: 'Prompt content', savePrompt: 'Save prompt revision',
  newPrompt: 'New prompt', tasks: 'Execution evidence', noTasks: 'No task executions recorded.',
  openSession: 'Open execution', workflows: 'Workflow runs', noRuns: 'No workflow runs recorded.',
  history: 'Plan history', pending: 'Awaiting approval', stale: 'Reload the project before retrying a conflicting change.',
} satisfies Record<string, string>
/** Project dictionary key vocabulary. */
export type ProjectLocaleKey = keyof typeof en
/** Brazilian Portuguese copy of the project workspace. */
export const pt = {
  title: 'Projetos', close: 'Fechar', refresh: 'Atualizar', loading: 'Carregando…',
  empty: 'Crie um projeto para organizar planos, prompts e evidências de execução.',
  name: 'Nome do projeto', workspace: 'Workspace', create: 'Criar projeto',
  select: 'Escolha um projeto', plan: 'Plano', summary: 'Resumo do plano',
  items: 'Título da tarefa', criteria: 'Critérios de aceite (um por linha)',
  addTask: 'Adicionar tarefa', removeTask: 'Remover tarefa', dependencies: 'Depende de',
  savePlan: 'Salvar nova revisão do plano', approve: 'Aprovar esta revisão',
  saveBeforeApproval: 'Salve suas alterações como uma nova revisão antes de aprovar este plano.',
  approved: 'Revisão aprovada', revision: 'Revisão', prompts: 'Biblioteca de prompts',
  promptName: 'Nome do prompt', template: 'Conteúdo do prompt', savePrompt: 'Salvar revisão do prompt',
  newPrompt: 'Novo prompt', tasks: 'Evidências de execução', noTasks: 'Nenhuma execução de tarefa registrada.',
  openSession: 'Abrir execução', workflows: 'Execuções de workflow', noRuns: 'Nenhuma execução de workflow registrada.',
  history: 'Histórico do plano', pending: 'Aguardando aprovação', stale: 'Recarregue o projeto antes de repetir uma alteração conflitante.',
} satisfies Record<ProjectLocaleKey, string>
