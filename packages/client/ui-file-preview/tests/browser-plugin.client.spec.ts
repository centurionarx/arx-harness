// @vitest-environment jsdom
import { Context } from '@arx-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@arx-ai/arx-client-runtime/client'
import { LocaleRuntime } from '@arx-ai/arx-client-locale/client'
import * as Preview from '../src/client/index.ts'
import * as HostMarker from '../src/index.ts'
import type { PreviewInjected } from '../src/client/FilePreviewPanel.tsx'
import type { SessionId } from '@arx-ai/arx-session/types'

it('waits for the Details chain declaration and disposes its capability and contribution', async () => {
  const ctx = new Context()
  await ctx.plugin(HostMarker)
  await ctx.plugin(SlotRegistry)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const read = vi.fn().mockResolvedValue({ ok: true, value: { path: 'report.md' } })
  ctx.provide('remote', { filePreviews: { read } })
  ctx.provide('remote.filePreviews', { read })
  const fiber = ctx.plugin(Preview)
  await fiber
  const owner = ctx.slots.register({ name: 'root', children: {
    'details.content': { kind: 'chain', scope: 'session' },
  } } as never, (() => null) as never)
  expect(ctx.slots.entries('details.content')).toHaveLength(1)
  expect(ctx.get('chatFilePreview')?.supports('report.md')).toBe(true)
  expect(ctx.get('chatFilePreview')?.supports('.')).toBe(false)
  expect(ctx.get('chatFilePreview')?.supports('program.exe')).toBe(false)
  expect(ctx.get('chatFilePreview')?.supports('drawing.svg')).toBe(false)
  expect(ctx.get('chatFilePreview')?.supports('directory')).toBe(false)
  const registration = ctx.slots.entries('details.content')[0] as unknown as {
    select: (owner: { preview?: { path: string } | null }) => { path: string } | null
    inject: (sessionId: SessionId) => PreviewInjected
  }
  expect(registration.select({})).toBeNull()
  expect(registration.select({ preview: { path: 'report.md' } })).toEqual({ path: 'report.md' })
  const injected = registration.inject('preview-owner' as SessionId)
  await expect(injected.read('report.md')).resolves.toEqual({ path: 'report.md' })
  expect(read).toHaveBeenCalledWith('preview-owner', 'report.md')
  read.mockResolvedValueOnce({ ok: false, error: { message: 'gateway denied' } })
  await expect(injected.read('report.md')).rejects.toThrow('gateway denied')
  await fiber.dispose()
  expect(ctx.slots.entries('details.content')).toEqual([])
  expect(ctx.get('chatFilePreview')).toBeUndefined()
  owner()
  await ctx.fiber.dispose()
})
