// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(), createWorker: vi.fn(), destroy: vi.fn(async () => {}),
  workerDestroy: vi.fn(), terminate: vi.fn(), cancel: vi.fn(), pageCleanup: vi.fn(),
}))
vi.mock('pdfjs-dist', () => ({ AnnotationMode: { DISABLE: 0 }, getDocument: pdf.getDocument, PDFWorker: { create: pdf.createWorker } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?raw', () => ({ default: 'worker source' }))
import { PdfPreview } from '../src/client/PdfPreview.tsx'
const input = { content: 'AA==', label: 'PDF preview', loading: 'Loading PDF', limited: 'First 10 pages', failed: 'PDF unavailable' }
const revoke = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('Worker', class { terminate = pdf.terminate })
  URL.createObjectURL = vi.fn(() => 'blob:pdf-worker')
  URL.revokeObjectURL = revoke
  pdf.createWorker.mockReturnValue({ destroy: pdf.workerDestroy })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function document(pages: number, renderPromise = Promise.resolve()) {
  return { numPages: pages, getPage: vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 100000 * scale, height: 100000 * scale }),
    render: () => ({ promise: renderPromise, cancel: pdf.cancel }), cleanup: pdf.pageCleanup,
  })) }
}
it('caps pages and canvas pixels and destroys the document, worker, and resource URL on unload', async () => {
  const source = document(20)
  pdf.getDocument.mockReturnValue({ promise: Promise.resolve(source), destroy: pdf.destroy })
  const view = render(<PdfPreview {...input} />)
  await screen.findByText('First 10 pages')
  expect(source.getPage).toHaveBeenCalledTimes(10)
  const canvases = [...view.container.querySelectorAll('canvas')]
  expect(canvases).toHaveLength(10)
  expect(canvases.every(canvas => canvas.width * canvas.height <= 2_000_000 && canvas.width <= 4096 && canvas.height <= 4096)).toBe(true)
  expect(pdf.getDocument).toHaveBeenCalledWith(expect.objectContaining({
    maxImageSize: 2_000_000, useWorkerFetch: false, enableXfa: false,
  }))
  view.unmount()
  expect(pdf.destroy).toHaveBeenCalledOnce(); expect(pdf.workerDestroy).toHaveBeenCalledOnce()
  expect(pdf.terminate).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith('blob:pdf-worker')
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true)
})
it('cancels an active page without waiting for renderer settlement', async () => {
  const source = document(1, new Promise(() => {}))
  pdf.getDocument.mockReturnValue({ promise: Promise.resolve(source), destroy: pdf.destroy })
  const view = render(<PdfPreview {...input} />)
  await waitFor(() => { expect(view.container.querySelector('canvas')).not.toBeNull() })
  view.unmount()
  expect(pdf.cancel).toHaveBeenCalledOnce(); expect(pdf.terminate).toHaveBeenCalledOnce()
})
it('contains malformed documents in a passive error state', async () => {
  pdf.getDocument.mockReturnValue({ promise: Promise.reject(new Error('malformed')), destroy: pdf.destroy })
  render(<PdfPreview {...input} />)
  expect((await screen.findByRole('alert')).textContent).toBe('PDF unavailable')
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
it('finishes a small document and replaces its pages when the source changes', async () => {
  const source = document(1)
  pdf.getDocument.mockReturnValue({ promise: Promise.resolve(source), destroy: pdf.destroy })
  const view = render(<PdfPreview {...input} />)
  await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
  expect(view.container.querySelectorAll('canvas')).toHaveLength(1)
  const next = deferred<ReturnType<typeof document>>()
  pdf.getDocument.mockReturnValue({ promise: next.promise, destroy: pdf.destroy })
  view.rerender(<PdfPreview {...input} content="AQ==" />)
  expect(screen.getByRole('status').textContent).toBe(input.loading)
  expect(view.container.querySelector('canvas')).toBeNull()
  await act(async () => { next.resolve(document(0)) })
  expect(screen.queryByRole('status')).toBeNull()
})
it.each(['document', 'page', 'render'] as const)('ignores late %s completion after the preview closes', async (stage) => {
  const pending = deferred<unknown>()
  const source = document(1, stage === 'render' ? pending.promise as Promise<void> : Promise.resolve())
  if (stage === 'page') source.getPage = vi.fn(() => pending.promise as ReturnType<typeof source.getPage>)
  pdf.getDocument.mockReturnValue({ promise: stage === 'document' ? pending.promise : Promise.resolve(source), destroy: pdf.destroy })
  const view = render(<PdfPreview {...input} />)
  if (stage === 'page') await waitFor(() => { expect(source.getPage).toHaveBeenCalledOnce() })
  if (stage === 'render') await waitFor(() => { expect(view.container.querySelector('canvas')).not.toBeNull() })
  view.unmount()
  await act(async () => { pending.resolve(stage === 'document' ? source : stage === 'page' ? {} : undefined) })
  expect(view.container.querySelector('canvas')).toBeNull()
  expect(pdf.terminate).toHaveBeenCalledOnce()
})
it('ignores parsing failure after close and contains failed worker destruction', async () => {
  const pending = deferred<unknown>()
  pdf.getDocument.mockReturnValue({ promise: pending.promise, destroy: vi.fn(async () => { throw new Error('worker already stopped') }) })
  const view = render(<PdfPreview {...input} />)
  view.unmount()
  await act(async () => { pending.reject(new Error('cancelled parsing')) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(pdf.terminate).toHaveBeenCalledOnce()
})
it('contains malformed base64 before creating an owned worker', async () => {
  const view = render(<PdfPreview {...input} content="%%%" />)
  expect((await screen.findByRole('alert')).textContent).toBe(input.failed)
  view.unmount()
  expect(pdf.createWorker).not.toHaveBeenCalled()
  expect(pdf.terminate).not.toHaveBeenCalled()
})
it.each([
  { width: Infinity, height: 2 }, { width: 2, height: NaN }, { width: 0, height: 2 }, { width: 2, height: -1 },
])('rejects invalid page dimensions %j before creating a canvas', async (dimensions) => {
  const renderPage = vi.fn()
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getViewport: () => dimensions, render: renderPage }) }),
    destroy: pdf.destroy,
  })
  const view = render(<PdfPreview {...input} />)
  expect((await screen.findByRole('alert')).textContent).toBe(input.failed)
  expect(renderPage).not.toHaveBeenCalled()
  expect(view.container.querySelector('canvas')).toBeNull()
})
