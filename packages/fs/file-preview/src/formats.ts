/** Explicit document allowlist shared by validation and optional preview capability checks. */
import type { FilePreview } from './types.ts'

interface PreviewFormat { kind: FilePreview['kind']; mediaType: string; encoding: FilePreview['encoding'] }
const text = { kind: 'code', mediaType: 'text/plain', encoding: 'utf8' } as const
const formats: Readonly<Record<string, PreviewFormat>> = {
  md: { kind: 'markdown', mediaType: 'text/markdown', encoding: 'utf8' },
  markdown: { kind: 'markdown', mediaType: 'text/markdown', encoding: 'utf8' },
  html: { kind: 'html', mediaType: 'text/html', encoding: 'utf8' },
  htm: { kind: 'html', mediaType: 'text/html', encoding: 'utf8' },
  pdf: { kind: 'pdf', mediaType: 'application/pdf', encoding: 'base64' },
  png: { kind: 'image', mediaType: 'image/png', encoding: 'base64' },
  jpg: { kind: 'image', mediaType: 'image/jpeg', encoding: 'base64' },
  jpeg: { kind: 'image', mediaType: 'image/jpeg', encoding: 'base64' },
  gif: { kind: 'image', mediaType: 'image/gif', encoding: 'base64' },
  webp: { kind: 'image', mediaType: 'image/webp', encoding: 'base64' },
  avif: { kind: 'image', mediaType: 'image/avif', encoding: 'base64' },
  ...Object.fromEntries(['txt', 'json', 'yaml', 'yml', 'csv', 'ts', 'tsx', 'js', 'jsx', 'py', 'css', 'sql', 'sh',
    'ps1', 'xml', 'toml', 'log', 'ini', 'c', 'cpp', 'java', 'rs', 'go'].map(extension => [extension, text])),
}

/**
 * Return an allowlisted format; SVG and unknown extensions have no preview.
 * @param path - original requested filename, with either platform separator.
 * @returns the known renderer and encoding, or undefined for unsupported files.
 */
export function previewFormat(path: string): PreviewFormat | undefined {
  const basename = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = basename.lastIndexOf('.')
  const extension = dot < 0 ? '' : basename.slice(dot + 1).toLowerCase()
  if (!Object.hasOwn(formats, extension)) return undefined
  return formats[extension]
}
