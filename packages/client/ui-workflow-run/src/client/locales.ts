/** `workflowRun` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'workflowRun'
/** English dictionary (same key set). */
export const en = {
  'run.title': '{name}',
  'run.members.one': '{count} member',
  'run.members.other': '{count} members',
  'run.empty': 'No members started',
  'phase.unassigned': 'Unphased',
  'phase.empty': 'Empty phase name',
  'statusCount.running': 'Running {count}',
  'statusCount.completed': 'Completed {count}',
  'statusCount.failed': 'Failed {count}',
  'statusCount.cancelled': 'Cancelled {count}',
  'statusCount.interrupted': 'Interrupted {count}',
  'member.empty': 'Empty member name',
  'member.open': 'Open {name}',
  'status.running': 'Running',
  'status.completed': 'Completed',
  'status.failed': 'Failed',
  'status.cancelled': 'Cancelled',
  'status.interrupted': 'Interrupted',
}

/** Union of this namespace's dictionary keys. */
export type WorkflowRunKey = keyof typeof en

/** Brazilian Portuguese dictionary. */
export const pt = {
  'run.title': '{name}',
  'run.members.one': '{count} membro',
  'run.members.other': '{count} membros',
  'run.empty': 'Nenhum membro iniciado',
  'phase.unassigned': 'Sem fase',
  'phase.empty': 'Nome de fase vazio',
  'statusCount.running': 'Executando {count}',
  'statusCount.completed': 'Concluídos {count}',
  'statusCount.failed': 'Com falha {count}',
  'statusCount.cancelled': 'Cancelados {count}',
  'statusCount.interrupted': 'Interrompidos {count}',
  'member.empty': 'Nome de membro vazio',
  'member.open': 'Abrir {name}',
  'status.running': 'Executando',
  'status.completed': 'Concluído',
  'status.failed': 'Falhou',
  'status.cancelled': 'Cancelado',
  'status.interrupted': 'Interrompido',
} satisfies Record<WorkflowRunKey, string>
