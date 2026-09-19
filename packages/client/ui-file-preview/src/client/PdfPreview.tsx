/** Passive PDF rasterization with owned worker, document and page lifetimes. */
import { useEffect, useRef, useState } from 'react'
import { AnnotationMode, getDocument, PDFWorker } from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'

const MAX_PAGES = 10
const MAX_PAGE_PIXELS = 2_000_000
const MAX_PAGE_EDGE = 4096
/**
 * Render the first bounded set of PDF pages as passive canvases.
 * @param props - base64 PDF bytes and localized state/limit descriptions.
 * @returns current rasterized pages, bounded-limit notice, or a passive error.
 */
export function PdfPreview({ content, label, loading, limited, failed }: {
  content: string
  label: string
  loading: string
  limited: string
  failed: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ source: string; status: 'loading' | 'done' | 'limited' | 'failed' }>({ source: content, status: 'loading' })
  const currentState = state.source === content ? state.status : 'loading'
  useEffect(() => {
    // React attaches this unconditional div before running the mounted effect.
    const target = container.current as HTMLDivElement
    const lifetime = new AbortController()
    const cancelled = (): boolean => lifetime.signal.aborted
    let task: PDFDocumentLoadingTask | undefined
    let rendering: RenderTask | undefined
    let worker: PDFWorker | undefined
    let port: Worker | undefined
    let workerUrl: string | undefined
    const canvases: HTMLCanvasElement[] = []
    target.replaceChildren()
    setState({ source: content, status: 'loading' })
    const operation = async (): Promise<void> => {
      const bytes = Uint8Array.from(atob(content), char => char.charCodeAt(0))
      workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
      port = new Worker(workerUrl, { type: 'module' })
      worker = PDFWorker.create({ port })
      task = getDocument({ data: bytes, worker, stopAtErrors: true, maxImageSize: MAX_PAGE_PIXELS,
        canvasMaxAreaInBytes: MAX_PAGE_PIXELS * 4, disableFontFace: true,
        useSystemFonts: true, useWorkerFetch: false, useWasm: false, enableXfa: false })
      const document = await task.promise
      if (cancelled()) return
      for (let number = 1; number <= Math.min(document.numPages, MAX_PAGES); number += 1) {
        const page = await document.getPage(number)
        if (cancelled()) return
        const original = page.getViewport({ scale: 1 })
        if (!Number.isFinite(original.width) || !Number.isFinite(original.height) || original.width <= 0 || original.height <= 0) throw new Error('Invalid PDF page dimensions')
        const scale = Math.min(1.5, MAX_PAGE_EDGE / original.width, MAX_PAGE_EDGE / original.height,
          Math.sqrt(MAX_PAGE_PIXELS / (original.width * original.height)))
        const viewport = page.getViewport({ scale })
        const canvas = window.document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height))
        canvas.style.maxWidth = '100%'; canvas.style.height = 'auto'
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', label + ' ' + String(number))
        canvases.push(canvas); target.append(canvas)
        rendering = page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE })
        await rendering.promise
        rendering = undefined
        page.cleanup()
        if (cancelled()) return
      }
      setState({ source: content, status: document.numPages > MAX_PAGES ? 'limited' : 'done' })
    }
    void operation().catch(() => { if (!cancelled()) setState({ source: content, status: 'failed' }) })
    return () => {
      lifetime.abort()
      rendering?.cancel()
      for (const canvas of canvases) { canvas.width = 0; canvas.height = 0 }
      target.replaceChildren()
      // Terminate the owned worker immediately even if parsing cannot answer a destroy request.
      void task?.destroy().catch(() => { /* The worker is already terminated; no resource remains. */ })
      worker?.destroy(); port?.terminate()
      if (workerUrl !== undefined) URL.revokeObjectURL(workerUrl)
    }
  }, [content, label])
  return <section aria-label={label}>
    {currentState === 'loading' && <p role="status">{loading}</p>}
    {currentState === 'limited' && <p>{limited}</p>}
    {currentState === 'failed' && <p role="alert">{failed}</p>}
    <div ref={container} />
  </section>
}
