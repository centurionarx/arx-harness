/** Document preview strings. */
export const en = {
  pdfLimited: 'Showing the first 10 pages. Open in the system application to view the complete document.',
  pdfFailed: 'This PDF could not be rendered. Open it in the system application to inspect it.',
  loading: 'Loading preview…', failed: 'Preview could not be loaded.', current: 'Current file contents',
  native: 'Open in system application', refresh: 'Refresh', pdf: 'PDF preview', html: 'HTML preview',
}
/** Localized file-preview copy keys. */
export type PreviewKey = keyof typeof en
/** Brazilian Portuguese document preview strings. */
export const pt = {
  pdfLimited: 'Mostrando as 10 primeiras páginas. Abra no aplicativo do sistema para ver o documento inteiro.',
  pdfFailed: 'Não foi possível renderizar este PDF. Abra-o no aplicativo do sistema para examiná-lo.',
  loading: 'Carregando a prévia…', failed: 'Não foi possível carregar a prévia.', current: 'Conteúdo atual do arquivo',
  native: 'Abrir no aplicativo do sistema', refresh: 'Atualizar', pdf: 'Prévia do PDF', html: 'Prévia do HTML',
} satisfies Record<PreviewKey, string>
