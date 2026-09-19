/** Current-file preview with request ownership and explicit Blob URL disposal. */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { MarkdownText } from '@arx-ai/arx-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@arx-ai/arx-client-ui-slots'
import type { FilePreview } from '@arx-ai/arx-file-preview/client'
import type {} from '@arx-ai/arx-client-ui-conversation/client'
import { safeHtmlDocument } from './safe-html.ts'
const PdfPreview = lazy(async () => ({ default: (await import('./PdfPreview.tsx')).PdfPreview }))
import css from './FilePreviewPanel.module.css'

/** Narrow Remote read callback owned by the registration. */
export interface PreviewInjected { read: (path: string) => Promise<FilePreview> }
type Props = PropsRuntime<'details.content'> & PreviewInjected & PropsLocale<'filePreview'> & { matched: { path: string } }

/** Display one current file; changing owners invalidates stale reads and releases binary resource URLs. */
export function FilePreviewPanel({ matched, sessionId, read, openNativeFile, t }: Props) {
  const requestKey = sessionId + '\0' + matched.path
  const [loaded, setLoaded] = useState<{ key: string; file: FilePreview } | null>(null)
  const file = loaded?.key === requestKey ? loaded.file : null
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let current = true
    setLoaded(null)
    setError(null)
    void read(matched.path).then((value) => { if (current) setLoaded({ key: requestKey, file: value }) }, (failure: unknown) => {
      if (current) setError(failure instanceof Error ? failure.message : t('failed'))
    })
    return () => { current = false }
  }, [matched.path, sessionId, read, revision])
  const [resource, setResource] = useState<{ file: FilePreview; url: string } | null>(null)
  useEffect(() => {
    if (file === null || file.kind !== 'image') { setResource(null); return }
    const bytes = Uint8Array.from(atob(file.content), char => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }))
    setResource({ file, url })
    return () => { URL.revokeObjectURL(url) }
  }, [file])
  const srcDoc = useMemo(() => file?.kind === 'html' ? safeHtmlDocument(file.content) : undefined, [file])
  const url = resource?.file === file ? resource.url : undefined
  return <section className={css.preview}>
    <div className={css.toolbar}>
      <button type="button" onClick={() => { setRevision(value => value + 1) }}>{t('refresh')}</button>
      <button type="button" onClick={() => { void openNativeFile(matched.path).catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : t('failed'))
      }) }}>{t('native')}</button>
    </div>
    <p className={css.caption}>{t('current')} · {matched.path}</p>
    {error !== null && <p role="alert">{error}</p>}
    {file === null && error === null && <p role="status">{t('loading')}</p>}
    {file?.kind === 'markdown' && <MarkdownText text={file.content} remoteImages={false} />}
    {file?.kind === 'code' && <pre className={css.code}><code>{file.content}</code></pre>}
    {file?.kind === 'html' && <iframe title={t('html')} sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc} className={css.frame} />}
    {file?.kind === 'image' && url !== undefined && <img src={url} alt={matched.path} className={css.image} />}
    {file?.kind === 'pdf' && <Suspense fallback={<p role="status">{t('loading')}</p>}>
      <PdfPreview content={file.content} label={t('pdf')} loading={t('loading')} limited={t('pdfLimited')} failed={t('pdfFailed')} />
    </Suspense>}
  </section>
}
