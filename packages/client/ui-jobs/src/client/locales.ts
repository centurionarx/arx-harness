/** `job` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'job'
/** English dictionary, the source of the namespace's key set. */
export const en = {
  'count.live.one': '{count} background job running',
  'count.live.other': '{count} background jobs running',
  'count.idle.one': '{count} background job',
  'count.idle.other': '{count} background jobs',
  'list.aria': 'Background jobs',
  'status.running': 'running',
  'status.stopping': 'stopping',
  'status.completed': 'completed',
  'status.killed': 'cancelled',
  'status.failed': 'failed',
  'duration.seconds': '{seconds}s',
  'duration.minutes': '{minutes}m {seconds}s',
  'duration.hours': '{hours}h {minutes}m',
  'duration.title.live': 'Running for {duration}',
  'duration.title.done': 'Took {duration}',
}

/** Key domain of the `job` namespace (en is the source of truth). */
export type JobKey = keyof typeof en

/** Brazilian Portuguese dictionary. */
export const pt = {
  'count.live.one': '{count} job em segundo plano em execução',
  'count.live.other': '{count} jobs em segundo plano em execução',
  'count.idle.one': '{count} job em segundo plano',
  'count.idle.other': '{count} jobs em segundo plano',
  'list.aria': 'Jobs em segundo plano',
  'status.running': 'executando',
  'status.stopping': 'parando',
  'status.completed': 'concluído',
  'status.killed': 'cancelado',
  'status.failed': 'falhou',
  'duration.seconds': '{seconds}s',
  'duration.minutes': '{minutes}min {seconds}s',
  'duration.hours': '{hours}h {minutes}min',
  'duration.title.live': 'Executando há {duration}',
  'duration.title.done': 'Levou {duration}',
} satisfies Record<JobKey, string>
