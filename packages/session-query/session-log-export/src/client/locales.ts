/** Locale namespace owned by Session export browser feedback. */
export const NS = 'session-log-download'
/** English Session export strings. */
export const en = {
  'dialog.preparingTitle': 'Exporting Session',
  'dialog.preparingDescription': 'Preparing a ZIP containing this Session, its sub-Sessions, and attachments.',
  'dialog.successTitle': 'Session download started',
  'dialog.successDescription': 'The browser is downloading the Session ZIP.',
  'dialog.errorTitle': 'Session export failed',
  'dialog.close': 'Close',
  'dialog.commandFailed': 'Could not start the Session export.',
}

/** Stable locale keys consumed by the shared modal. */
export type SessionLogDownloadKey = keyof typeof en

/** Brazilian Portuguese Session export strings. */
export const pt = {
  'dialog.preparingTitle': 'Exportando a sessão',
  'dialog.preparingDescription': 'Preparando um ZIP com esta sessão, as subsessões e os anexos.',
  'dialog.successTitle': 'Download da sessão iniciado',
  'dialog.successDescription': 'O navegador está baixando o ZIP da sessão.',
  'dialog.errorTitle': 'Falha ao exportar a sessão',
  'dialog.close': 'Fechar',
  'dialog.commandFailed': 'Não foi possível iniciar a exportação da sessão.',
} satisfies Record<SessionLogDownloadKey, string>
