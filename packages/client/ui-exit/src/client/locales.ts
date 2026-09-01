/** Exit-seat dictionaries: the foot row and its confirmation. */
/** The exit namespace key union. */
export type ExitKey = keyof typeof en

/** English dictionary. */
export const en = {
  'trigger': 'Exit',
  'confirm.title': 'Exit arx Harness?',
  'confirm.description': 'The server stops and every attached session disconnects. Session logs are durable, so a restart resumes them.',
  'confirm.cancel': 'Cancel',
  'confirm.stop': 'Stop the server',
  'close': 'Close',
  'stopping': 'Stopping…',
  'unavailable': 'This deployment offers no way to exit',
} satisfies Record<string, string>
