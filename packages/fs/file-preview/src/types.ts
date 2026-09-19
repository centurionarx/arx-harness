/** JSON-only file preview response. It represents bytes read now, not a retained artifact. */
export interface FilePreview {
  /** Original session-relative or absolute path requested by the user. */
  readonly path: string
  /** Whitelisted renderer selected from the file extension. */
  readonly kind: 'markdown' | 'code' | 'html' | 'image' | 'pdf'
  /** Whitelisted content type; never supplied by the file contents. */
  readonly mediaType: string
  /** UTF-8 text for documents, base64 for raster images and PDF. */
  readonly encoding: 'utf8' | 'base64'
  /** Bounded decoded text or base64 bytes. */
  readonly content: string
  /** Number of source bytes read within the configured cap. */
  readonly bytes: number
}
