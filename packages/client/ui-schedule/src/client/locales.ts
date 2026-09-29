/** `schedule.catalog` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'schedule.catalog'

/** English dictionary (the key-set source of truth). */
export const en = {
  'trigger.one': '{count} reminder',
  'trigger.other': '{count} reminders',
  'list.aria': 'Active reminders',
  'status.scheduled': 'Scheduled',
  'status.overdue': 'Overdue',
  'frequency.once': 'Once',
  'frequency.every': 'Every {value} {unit}',
  'unit.day.one': 'day',
  'unit.day.other': 'days',
  'unit.hour.one': 'hour',
  'unit.hour.other': 'hours',
  'unit.minute.one': 'minute',
  'unit.minute.other': 'minutes',
  'unit.second.one': 'second',
  'unit.second.other': 'seconds',
  'relative.now': 'Due now',
  'relative.future': 'in {value} {unit}',
  'relative.overdue': '{value} {unit} overdue',
} satisfies Record<string, string>

/** Key domain of the Schedule catalog namespace. */
export type ScheduleCatalogKey = keyof typeof en

/** Brazilian Portuguese dictionary. */
export const pt = {
  'trigger.one': '{count} lembrete',
  'trigger.other': '{count} lembretes',
  'list.aria': 'Lembretes ativos',
  'status.scheduled': 'Agendado',
  'status.overdue': 'Atrasado',
  'frequency.once': 'Uma vez',
  'frequency.every': 'A cada {value} {unit}',
  'unit.day.one': 'dia',
  'unit.day.other': 'dias',
  'unit.hour.one': 'hora',
  'unit.hour.other': 'horas',
  'unit.minute.one': 'minuto',
  'unit.minute.other': 'minutos',
  'unit.second.one': 'segundo',
  'unit.second.other': 'segundos',
  'relative.now': 'Vence agora',
  'relative.future': 'em {value} {unit}',
  'relative.overdue': 'atrasado há {value} {unit}',
} satisfies Record<ScheduleCatalogKey, string>
