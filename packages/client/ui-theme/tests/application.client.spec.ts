// @vitest-environment jsdom
/** ui-theme in an application tree: without a preference scope, the theme service drives a document presenter. */
import { Context } from '@arx-ai/cordis'
import { expect, it } from 'vitest'
import { SlotRegistry } from '@arx-ai/arx-client-runtime/client'
import { LocaleRuntime } from '@arx-ai/arx-client-locale/client'
import { application, DARK_ATTRIBUTE } from '@arx-ai/arx-client-ui-theme/client'
import type { ThemeRuntime } from '@arx-ai/arx-client-ui-theme/client'

it('presents every theme change on the document and retracts the presenter on dispose', async () => {
  const ctx = new Context()
  ctx.provide('clientComposition', { kind: 'public', audience: 'user', scope: 'application' })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin(application)
  await fiber.await()
  const theme = ctx.get('theme') as ThemeRuntime
  theme.setTheme('light')
  expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  theme.setTheme('dark')
  expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
  expect(document.documentElement.style.colorScheme).toBe('dark')
  await fiber.dispose()
  expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  await ctx.fiber.dispose()
})
