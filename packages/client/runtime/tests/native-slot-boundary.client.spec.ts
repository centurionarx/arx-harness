/** Tree metadata is presentation only; native runtime cannot synthesize its missing slot provider. */
import { Context } from '@arx-ai/cordis'
import { expect, it } from 'vitest'
import * as RuntimeClient from '../src/client/index.ts'

it('fails before mounting any project service when a native tree lacks its neutral slot provider', async () => {
  const ctx = new Context()
  ctx.reflect.provide('clientComposition', Object.freeze({ kind: 'user', audience: 'user', scope: 'project', generation: 1 }))
  expect(() => { RuntimeClient.apply(ctx) }).toThrow('native runtime requires the slot provider')
  for (const service of ['slots', 'sessions', 'workspaces', 'connection'] as const) expect(ctx.get(service)).toBeUndefined()
  await ctx.fiber.dispose()
})
