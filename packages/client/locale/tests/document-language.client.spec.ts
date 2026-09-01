// @vitest-environment jsdom
/**
 * `<html lang>` tracks the active locale.
 *
 * The served markup declares one language, but the resolved locale may differ
 * (browser detection, or a stored Host preference adopted after activation).
 * Assistive technology and browser features read this attribute, so a stale
 * value misreports the document language rather than merely looking untidy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import { SlotRegistry } from '@arx-ai/arx-client-runtime/client'
import { apply as settingsApply, inject as settingsInject } from '@arx-ai/arx-client-ui-settings/client'
import { TestRemote } from '@arx-ai/arx-client-test-runtime'
import { apply, inject } from '@arx-ai/arx-client-locale/client'
import type { LocaleRuntime } from '@arx-ai/arx-client-locale/client'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema } from '../src/locale-settings.ts'

/** Boot the plugin over a stub Host settings document. */
async function bench(preference?: string) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  let stored = preference
  let revision = 0
  const namespace = () => ({
    ns: LOCALE_SETTINGS_NAMESPACE,
    schema: LocaleSettingsSchema.toJSON(),
    value: stored === undefined ? {} : { preference: stored },
    applies: 'live' as const,
    secrets: [],
    revision,
  })
  const describeRpc = vi.fn(async () => ({
    rpcId: 'locale-describe' as never,
    result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [namespace()] } },
  }))
  const mutate = vi.fn(async (request: { ops: { value: string }[] }) => {
    stored = request.ops[0]!.value
    revision += 1
    return { rpcId: 'locale-mutate' as never, result: { ok: true as const, value: namespace() } }
  })
  ctx.provide('connection', { api: { settings: { describe: describeRpc, mutate } }, isLoopback: true } as never)
  // The settings transport and the forwarded-event port the plugin injects.
  new TestRemote(ctx)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, locale: ctx.get('locale') as LocaleRuntime }
}

const langOf = (): string => document.documentElement.lang

describe('document language', () => {
  beforeEach(() => {
    // A stale tag stands in the served markup, so every assertion below fails
    // unless the plugin states the resolved locale itself.
    document.documentElement.lang = 'zh-CN'
    Object.defineProperty(navigator, 'languages', { value: ['zh-CN'], configurable: true })
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
  })

  afterEach(() => {
    // navigator properties are installed with defineProperty above, so they
    // are removed the same way; nothing here goes through vi.stubGlobal.
    const own = navigator as unknown as Record<string, unknown>
    delete own.languages
    delete own.language
  })

  it('states the resolved locale at activation, not the value the markup shipped', async () => {
    // A Chinese browser names no shipped language, so resolution lands on the
    // English fallback and the markup tag is replaced rather than trusted.
    const { locale } = await bench()
    expect(locale.getLocale().active).toBe('en')
    expect(langOf()).toBe('en')
  })

  it('holds the BCP 47 tag across locale selections', async () => {
    const { locale } = await bench()
    expect(langOf()).toBe('en')
    // `en` needs no region subtag.
    locale.setLocale('en')
    expect(langOf()).toBe('en')
    // A retired id is rejected outright, so no selection can point the
    // attribute at a language the client no longer ships.
    expect(() => { locale.setLocale('zh') }).toThrow('not registered')
    expect(langOf()).toBe('en')
  })

  it('follows an explicit Host preference adopted after activation', async () => {
    const { locale } = await bench('en')
    await vi.waitFor(() => { expect(locale.getLocale().active).toBe('en') })
    await vi.waitFor(() => { expect(langOf()).toBe('en') })
  })
})
