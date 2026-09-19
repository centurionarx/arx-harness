// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { makeTranslate } from '@arx-ai/arx-client-test-runtime'
import type { FilePreview } from '@arx-ai/arx-file-preview/client'
import { FilePreviewPanel } from '../src/client/FilePreviewPanel.tsx'
import { safeHtmlDocument } from '../src/client/safe-html.ts'
import { en } from '../src/client/locales.ts'

vi.mock('../src/client/PdfPreview.tsx', () => ({ PdfPreview: ({ label }: { label: string }) => <canvas aria-label={label} /> }))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const createObjectURL = vi.fn<(blob: Blob) => string>()
const revokeObjectURL = vi.fn<(url: string) => void>()
beforeEach(() => {
  let id = 0
  createObjectURL.mockReset().mockImplementation(() => 'blob:preview-' + String(++id))
  revokeObjectURL.mockReset()
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})
const markdown: FilePreview = { path: 'report.md', kind: 'markdown', mediaType: 'text/markdown', encoding: 'utf8',
  content: '# Report\n\n![blocked](https://example.com/tracker.png)\n\n<script>bad()</script>', bytes: 80 }
function props(file: FilePreview = markdown): ComponentProps<typeof FilePreviewPanel> {
  return { sessionId: 's1', matched: { path: file.path }, preview: { path: file.path },
    read: vi.fn(async () => file), openNativeFile: vi.fn(async () => {}), t: makeTranslate(en),
  } as unknown as ComponentProps<typeof FilePreviewPanel>
}

it('renders Markdown without active HTML or automatic remote media and keeps native opening explicit', async () => {
  const input = props()
  const view = render(<FilePreviewPanel {...input} />)
  await screen.findByRole('heading', { name: 'Report' })
  expect(view.container.querySelector('img')).toBeNull()
  expect(view.container.querySelector('script')).toBeNull()
  expect(input.openNativeFile).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Open in system application'))
  expect(input.openNativeFile).toHaveBeenCalledWith('report.md')
})

it('renders code as escaped text', async () => {
  const file = { ...markdown, path: 'script.js', kind: 'code' as const, content: '<script>bad()</script>' }
  const view = render(<FilePreviewPanel {...props(file)} />)
  await screen.findByText('<script>bad()</script>')
  expect(view.container.querySelector('script')).toBeNull()
})

it('renders HTML only in an opaque sandbox with restrictive CSP and removes active elements and URLs', async () => {
  const source = '<meta http-equiv="refresh" content="0;url=https://evil.test"><script>bad()</script><h1 class="safe-heading" onclick="bad()">Title</h1>'
    + '<a href="https://evil.test">link</a><iframe src="https://evil.test"></iframe><img src="https://evil.test/track">'
    + '<svg onload="bad()"></svg><form action="https://evil.test"><input></form>'
  const safe = safeHtmlDocument(source)
  expect(safe).not.toContain('https://evil.test')
  expect(safe).not.toContain('onclick')
  expect(safe).not.toContain('<script')
  expect(safe).toContain("default-src 'none'")
  render(<FilePreviewPanel {...props({ ...markdown, kind: 'html', path: 'page.html', content: source })} />)
  const frame = await screen.findByTitle('HTML preview')
  expect(frame.getAttribute('sandbox')).toBe('')
  expect(frame.getAttribute('srcdoc')).toContain("script-src 'none'")
})

it('revokes Blob URLs when binary previews are replaced and unmounted', async () => {
  const image: FilePreview = { ...markdown, path: 'chart.png', kind: 'image', mediaType: 'image/png', encoding: 'base64', content: 'AA==' }
  const view = render(<FilePreviewPanel {...props(image)} />)
  await screen.findByRole('img')
  expect(createObjectURL).toHaveBeenCalledOnce()
  const pdf: FilePreview = { ...image, path: 'report.pdf', kind: 'pdf', mediaType: 'application/pdf' }
  view.rerender(<FilePreviewPanel {...props(pdf)} />)
  await screen.findByLabelText('PDF preview')
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
  view.unmount()
  expect(createObjectURL).toHaveBeenCalledOnce()
})

it('ignores a stale response after a path or session changes', async () => {
  let resolve!: (value: FilePreview) => void
  const first = props()
  first.read = () => new Promise((done) => { resolve = done })
  const view = render(<FilePreviewPanel {...first} />)
  const next = props({ ...markdown, path: 'new.md', content: '# New file' })
  view.rerender(<FilePreviewPanel {...next} />)
  await screen.findByRole('heading', { name: 'New file' })
  await act(async () => { resolve(markdown) })
  expect(screen.queryByRole('heading', { name: 'Report' })).toBeNull()
})

it('shows failed reads and refreshes current contents on request', async () => {
  const input = props()
  input.read = vi.fn().mockRejectedValueOnce(new Error('access denied')).mockResolvedValue(markdown)
  render(<FilePreviewPanel {...input} />)
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('access denied') })
  fireEvent.click(screen.getByText('Refresh'))
  await screen.findByRole('heading', { name: 'Report' })
})

it.each([new Error('native denied'), 'opaque native rejection'])('reports explicit native-open failures without changing contents', async (failure) => {
  const input = props(); input.openNativeFile = vi.fn().mockRejectedValue(failure)
  render(<FilePreviewPanel {...input} />); await screen.findByRole('heading', { name: 'Report' })
  fireEvent.click(screen.getByText('Open in system application'))
  expect((await screen.findByRole('alert')).textContent).toBe(failure instanceof Error ? failure.message : en.failed)
  expect(screen.getByRole('heading', { name: 'Report' })).toBeTruthy()
})
it('contains opaque read failures and ignores rejected requests from an older owner', async () => {
  let reject!: (error: unknown) => void
  const first = props(); first.read = () => new Promise((_resolve, fail) => { reject = fail })
  const view = render(<FilePreviewPanel {...first} />)
  const next = props({ ...markdown, path: 'next.md' }); next.read = vi.fn().mockRejectedValue('opaque')
  view.rerender(<FilePreviewPanel {...next} />)
  expect((await screen.findByRole('alert')).textContent).toBe(en.failed)
  await act(async () => { reject(new Error('old failure')) })
  expect(screen.queryByText('old failure')).toBeNull()
})
