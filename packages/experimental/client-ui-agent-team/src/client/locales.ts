/** Agent Team roster and task graph copy. */
export const NS = 'agentTeam'

/** English strings (the key-set source of truth). */
export const en = {
  'trigger': 'Team: {members} members, {tasks} tasks',
  'members': 'Team members',
  'tasks': 'Task dependencies',
  'lead': 'Lead',
  'status.running': 'running',
  'status.idle': 'idle',
  'status.inactive': 'inactive',
  'status.provisioning': 'provisioning',
  'status.failed': 'failed',
  'task.pending': 'pending',
  'task.in_progress': 'in progress',
  'task.completed': 'completed',
  'blockedBy': 'Blocked by: {tasks}',
  'ready': 'Ready',
  'open': 'Open {name} session',
} satisfies Record<string, string>

/** Translation keys shared by the Team overlay dictionaries. */
export type TeamKey = keyof typeof en

/** Brazilian Portuguese strings. */
export const pt = {
  'trigger': 'Equipe: {members} membros, {tasks} tarefas',
  'members': 'Membros da equipe',
  'tasks': 'Dependências das tarefas',
  'lead': 'Líder',
  'status.running': 'executando',
  'status.idle': 'ocioso',
  'status.inactive': 'inativo',
  'status.provisioning': 'provisionando',
  'status.failed': 'falhou',
  'task.pending': 'pendente',
  'task.in_progress': 'em andamento',
  'task.completed': 'concluída',
  'blockedBy': 'Bloqueada por: {tasks}',
  'ready': 'Pronta',
  'open': 'Abrir a sessão de {name}',
} satisfies Record<TeamKey, string>
