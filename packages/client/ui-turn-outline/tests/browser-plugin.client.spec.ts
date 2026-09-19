// @vitest-environment jsdom
import { Context } from '@arx-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@arx-ai/arx-client-runtime/client'
import { LocaleRuntime } from '@arx-ai/arx-client-locale/client'
import * as Outline from '../src/client/index.ts'
import * as HostMarker from '../src/index.ts'
import type { OutlineInjected } from '../src/client/TurnOutline.tsx'
import type { SessionId } from '@arx-ai/arx-session/types'

it('waits for the view declaration and removes its contribution with the plugin', async () => {
  const ctx = new Context()
  await ctx.plugin(HostMarker)
  await ctx.plugin(SlotRegistry)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const page = vi.fn().mockResolvedValue({ ok: true, value: { turns: [], total: 0, hasMore: false } })
  ctx.provide('remote', { turnOutlines: { page } })
  ctx.provide('remote.turnOutlines', { page })
  const fiber = ctx.plugin(Outline)
  await fiber
  const owner = ctx.slots.register({ name: 'root', children: {
    'conversation.view': { kind: 'list', scope: 'session' },
  } } as never, (() => null) as never)
  expect(ctx.slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['turn-outline'])
  const registration = ctx.slots.entries('conversation.view')[0] as unknown as {
    options: { label: () => string }
    inject: (sessionId: SessionId) => OutlineInjected
  }
  expect(registration.options.label()).toBe('Turn outline')
  const injected = registration.inject('outline-owner' as SessionId)
  await expect(injected.readPage(null, '')).resolves.toEqual({ turns: [], total: 0, hasMore: false })
  expect(page).toHaveBeenCalledWith('outline-owner', null, '')
  page.mockResolvedValueOnce({ ok: false, error: { message: 'gateway denied' } })
  await expect(injected.readPage(50, 'old')).rejects.toThrow('gateway denied')
  await fiber.dispose()
  expect(ctx.slots.entries('conversation.view')).toEqual([])
  owner()
  await ctx.fiber.dispose()
})
