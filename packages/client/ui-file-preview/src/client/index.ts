/** Optional Details contribution and file-open capability marker. */
import type { ClientContext } from '@arx-ai/arx-client-runtime/client'
import type {} from '@arx-ai/arx-api-remotes/client'
import type {} from '@arx-ai/arx-client-locale/client'
import type {} from '@arx-ai/arx-client-ui-conversation/client'
import { previewFormat } from '@arx-ai/arx-file-preview/client'
import { FilePreviewPanel, type PreviewInjected } from './FilePreviewPanel.tsx'
import { en, pt, type PreviewKey } from './locales.ts'
declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap { /** File preview copy. */ filePreview: PreviewKey }
}
/** Content reads use the existing authenticated Remote capability. */
export const inject = ['slots', 'locale', 'remote', 'remote.filePreviews']
/** Register only while the existing Details owner declares its extension seat. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('filePreview', { en, pt }), 'file preview: dictionaries')
  ctx.provide('chatFilePreview', { supports: (path: string) => previewFormat(path) !== undefined })
  ctx.slots.inject('details.content', () => ctx.slots.register({
    name: 'details.content', locale: 'filePreview',
    select: owner => owner.preview ?? null,
    inject: (sessionId): PreviewInjected => ({ read: async (path) => {
      const response = await ctx.remote.filePreviews.read(sessionId, path)
      if (!response.ok) throw new Error(response.error.message)
      return response.value
    } }),
  }, FilePreviewPanel))
}
