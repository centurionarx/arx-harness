// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import { stubSettingsScope, type StubSettingsScope } from '@arx-ai/arx-client-test-runtime'
import type { LocaleSettings, LocaleSnapshot } from '@arx-ai/arx-client-locale/client'
import { FALLBACK_LOCALE, LocaleRuntime } from '@arx-ai/arx-client-locale/client'
const make = (host?: StubSettingsScope<LocaleSettings>): {
  ctx: Context
  svc: LocaleRuntime
  events: LocaleSnapshot[]
} => {
  const ctx = new Context()
  const events: LocaleSnapshot[] = []
  ctx.on('locale/change', (snapshot) => { events.push(snapshot) })
  return { ctx, svc: new LocaleRuntime(ctx, host?.scope), events }
}

/**
 * Pin the browser environment a fresh service reads its initial locale from.
 * This package's own specs stub the globals directly instead of using
 * `usePinnedBrowserLanguages` (arx-client-test-runtime): they need the shapes
 * that helper deliberately cannot express — a missing `languages` list, a
 * list decoupled from `language`, and a non-browser run with no `window`.
 */
const stubLanguages = (...tags: string[]): void => {
  vi.stubGlobal('navigator', { languages: tags, language: tags[0] ?? '' })
}

describe('LocaleRuntime', () => {
  beforeEach(() => {
    // A browser asking for the one shipped language is the baseline; specs
    // needing another arrangement re-stub it themselves.
    stubLanguages('en-US')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('translates through the active-locale dictionary, echoing an unresolved key', () => {
    const { svc } = make()
    svc.register('ns', 'en', { hello: 'Hello', onlyEn: 'English only' })
    const t = svc.bind('ns')
    expect(svc.getLocale().active).toBe('en')
    expect(t('hello')).toBe('Hello')
    expect(t('onlyEn')).toBe('English only')
    // No dictionary carries this key: it surfaces as itself rather than blank.
    expect(t('missing.key')).toBe('missing.key')
  })

  it('falls through to the common vocabulary after the namespace misses (production keys)', () => {
    const { svc } = make()
    // The shipped common dictionary is registered by apply; the bench registers
    // it directly to pin the production chain: ns -> common -> key.
    svc.register('common', 'en', { retry: 'Retry' })
    svc.register('ns', 'en', { own: 'Own' })
    const t = svc.bind('ns')
    expect(t('retry')).toBe('Retry')
    expect(t('own')).toBe('Own')
    // common itself must not recurse: a miss inside common echoes the key.
    // (Wide-string ns hits the untyped bind overload — the typed one rejects
    // unknown keys at compile time, which is the point of the typed registry contract.)
    expect(svc.bind('common' as string)('nope')).toBe('nope')
  })

  it('interpolates {name} params and leaves unknown placeholders intact', () => {
    const { svc } = make()
    svc.register('ns', 'en', { greet: 'Hello, {name}! Attempt {n}', partial: '{known} and {unknown}' })
    const t = svc.bind('ns')
    expect(t('greet', { name: 'World', n: 2 })).toBe('Hello, World! Attempt 2')
    expect(t('partial', { known: 'A' })).toBe('A and {unknown}')
  })

  it('bind returns a stable per-namespace function identity', () => {
    const { svc } = make()
    expect(svc.bind('a')).toBe(svc.bind('a'))
    expect(svc.bind('a')).not.toBe(svc.bind('b'))
  })

  it('rejects duplicate (ns, locale) and disposer only removes its own dict', () => {
    const { svc } = make()
    const dispose = svc.register('ns', 'en', { k: 'v1' })
    expect(() => svc.register('ns', 'en', { k: 'v2' })).toThrow('already has locale')
    dispose()
    const t = svc.bind('ns')
    expect(t('k')).toBe('k')
    svc.register('ns', 'en', { k: 'v2' })
    expect(t('k')).toBe('v2')
    dispose()
    expect(t('k')).toBe('v2')
  })

  it('serves the LocaleFace: snapshot revision moves on registration, subscribers fire, unsubscribe stops them', () => {
    const { svc } = make()
    const seen: number[] = []
    const off = svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
    expect(svc.getSnapshot()).toBe(svc.getLocale())
    const r0 = svc.getSnapshot().revision
    svc.register('ns', 'en', { k: 'v' })
    expect(svc.getSnapshot().revision).toBe(r0 + 1)
    expect(seen).toEqual([r0 + 1])
    off()
    svc.register('ns2', 'en', { k: 'v' })
    expect(svc.getSnapshot().revision).toBe(r0 + 2)
    expect(seen).toHaveLength(1)
  })

  it('isolates a throwing subscriber: the rest still see the new revision', () => {
    const { svc } = make()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const seen: number[] = []
      svc.subscribe(() => { throw new Error('boom') })
      svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
      svc.register('ns', 'en', { k: 'v' })
      expect(seen).toEqual([1])
      expect(spy).toHaveBeenCalledOnce()
    } finally {
      spy.mockRestore()
    }
  })

  it('register disposer republishes (mounted outlets drop the dead dictionary)', () => {
    const { svc } = make()
    const dispose = svc.register('ns', 'en', { k: 'v' })
    const before = svc.getSnapshot().revision
    dispose()
    expect(svc.getSnapshot().revision).toBe(before + 1)
    // Second run hits the idempotent arm: nothing removed, no republish.
    dispose()
    expect(svc.getSnapshot().revision).toBe(before + 1)
  })

  it('setLocale writes on every pick and announces only the selection that moves', () => {
    const host = stubSettingsScope<LocaleSettings>()
    const { svc, events } = make(host)
    // The one shipped locale is always the one on screen, so the pick changes
    // no language — it changes what decides the language, from the provisional
    // browser resolution to an explicit choice, and that is announced once.
    svc.setLocale('en')
    expect(svc.getLocale().active).toBe('en')
    expect(host.set).toHaveBeenCalledWith('preference', 'en')
    expect(events).toHaveLength(1)
    // Re-picking the standing selection writes again — the durable value may
    // still be missing for another browser sharing the same ARX home — and
    // announces nothing, because nothing about the selection moved.
    svc.setLocale('en')
    expect(events).toHaveLength(1)
    expect(host.set).toHaveBeenCalledTimes(2)
    expect(host.set).toHaveBeenLastCalledWith('preference', 'en')
  })

  it('a moved selection bumps the LocaleFace revision; a repeated one leaves outlets alone', () => {
    const { svc } = make()
    const seen: number[] = []
    svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
    const before = svc.getSnapshot().revision
    svc.setLocale('en')
    expect(svc.getSnapshot().revision).toBe(before + 1)
    expect(seen).toEqual([before + 1])
    // The selection now stands: picking it again re-renders no outlet.
    svc.setLocale('en')
    expect(svc.getSnapshot().revision).toBe(before + 1)
    expect(seen).toHaveLength(1)
  })

  it('persists an explicit pick of the provisional locale, so a shared ARX home agrees', () => {
    // A browser naming no shipped language opens at FALLBACK_LOCALE with
    // nothing stored. Choosing that same language in the menu must still become
    // durable: the stored selection, not each browser's own language list,
    // decides what a shared ARX home opens in.
    stubLanguages('fr-FR')
    const host = stubSettingsScope<LocaleSettings>()
    const { svc } = make(host)
    expect(svc.getLocale().active).toBe('en')
    expect(host.set).not.toHaveBeenCalled()
    svc.setLocale('en')
    expect(host.set).toHaveBeenCalledWith('preference', 'en')
  })

  it('setLocale without a host scope stays process-local', () => {
    const { svc, events } = make()
    svc.setLocale('en')
    expect(svc.getLocale().active).toBe('en')
    // The selection is announced in-process; the absent scope is not an error
    // and no write is attempted.
    expect(events).toHaveLength(1)
  })

  it('throws on unknown locale ids', () => {
    const { svc } = make()
    expect(() => { svc.setLocale('fr') }).toThrow('not registered')
    // The retired Chinese locale is an unknown id like any other: a stale menu
    // or a stored preference from an older client cannot resurrect it.
    expect(() => { svc.setLocale('zh') }).toThrow('not registered')
  })

  it('adopts a Host preference without writing it back', () => {
    const host = stubSettingsScope<LocaleSettings>()
    const { svc, events } = make(host)
    host.publish({ status: 'ready', value: { preference: 'en' }, revision: 1, writable: true })
    expect(svc.getLocale().active).toBe('en')
    // Adoption is a read: the accepted section is already what the Host holds,
    // so nothing is echoed back — but the stored answer replacing the
    // provisional resolution is announced once.
    expect(host.set).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
    // A later settings revision carrying the same selection is not a move: no
    // listener hears it again.
    host.publish({ value: { preference: 'en' }, revision: 2 })
    expect(events).toHaveLength(1)
  })

  it('an absent Host preference returns to the browser-derived locale', () => {
    const host = stubSettingsScope<LocaleSettings>()
    const { svc, events } = make(host)
    host.publish({ status: 'ready', value: { preference: 'en' }, revision: 1, writable: true })
    expect(svc.getLocale().active).toBe('en')
    // A section carrying no selection delegates to the browser-derived value
    // rather than clearing the active locale; here that value is the one
    // already standing, so the clear announces nothing.
    host.publish({ value: {}, revision: 2 })
    expect(svc.getLocale().active).toBe('en')
    expect(events).toHaveLength(1)
  })

  it('adopts a section already standing at construction and releases its subscription on dispose', async () => {
    const host = stubSettingsScope<LocaleSettings>()
    host.publish({ status: 'ready', value: { preference: 'en' }, revision: 1, writable: true })
    const { ctx, svc } = make(host)
    expect(svc.getLocale().active).toBe('en')
    expect(host.listenerCount()).toBe(1)
    await ctx.fiber.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  it('opens provisionally in the browser language, matching regional variants on their primary subtag', () => {
    stubLanguages('en-GB', 'fr-FR')
    expect(make().svc.getLocale().active).toBe('en')
    // An unshipped language walks the list to the first one this app ships.
    stubLanguages('fr-FR', 'en-US')
    expect(make().svc.getLocale().active).toBe('en')
    // Only `language` populated: an empty ordered list, and a host that
    // exposes no `languages` property at all.
    vi.stubGlobal('navigator', { languages: [], language: 'en-US' })
    expect(make().svc.getLocale().active).toBe('en')
    vi.stubGlobal('navigator', { language: 'en-US' })
    expect(make().svc.getLocale().active).toBe('en')
    // No shipped language anywhere in the browser's preferences: en is the
    // product default rather than an arbitrary near-match.
    stubLanguages('fr-FR', 'de')
    expect(make().svc.getLocale().active).toBe('en')
  })

  it('runs outside a browser (node boots): the fallback decides', () => {
    vi.stubGlobal('window', undefined)
    // Node exposes its own global navigator; without a window the resolution
    // must not reach it at all.
    stubLanguages('en-US')
    expect(make().svc.getLocale().active).toBe('en')
  })

  it('serves English as both the opening locale and the dictionary fallback', () => {
    // One constant covers both jobs: the locale the UI opens in with no usable
    // browser signal, and the dictionary every lookup ends at.
    expect(FALLBACK_LOCALE).toBe('en')
    vi.stubGlobal('window', undefined)
    const { svc } = make()
    expect(svc.getLocale().active).toBe(FALLBACK_LOCALE)
    svc.register('ns', FALLBACK_LOCALE, { onlyEn: 'English only' })
    expect(svc.bind('ns')('onlyEn')).toBe('English only')
    // A namespace that does not carry the key surfaces the key itself (fail
    // loud) instead of borrowing another namespace's text.
    svc.register('ns2', FALLBACK_LOCALE, {})
    expect(svc.bind('ns2')('onlyEn')).toBe('onlyEn')
  })

  it('exposes the shipped locales with their self-described labels', () => {
    const { svc } = make()
    expect(svc.getLocale().locales).toEqual([
      { id: 'en', label: 'English' },
      { id: 'pt', label: 'Português (Brasil)' },
    ])
  })

  it('renders a namespace in the active locale and in English where it ships no dictionary for it', () => {
    const { svc } = make()
    svc.register('common', { en: { retry: 'Retry' }, pt: { retry: 'Tentar novamente' } } as never)
    svc.register('translated', { en: { title: 'Title' }, pt: { title: 'Título' } } as never)
    svc.register('englishOnly', { en: { title: 'Title' } } as never)
    svc.setLocale('pt')
    expect(svc.bind('translated')('title')).toBe('Título')
    expect(svc.bind('englishOnly')('title')).toBe('Title')
    // The shared vocabulary follows the active locale from any namespace.
    expect(svc.bind('englishOnly')('retry')).toBe('Tentar novamente')
    svc.setLocale('en')
    expect(svc.bind('translated')('title')).toBe('Title')
  })

  it('opens in Portuguese for a browser asking for any Portuguese variant', () => {
    stubLanguages('pt-PT', 'en-US')
    expect(make().svc.getLocale().active).toBe('pt')
    stubLanguages('fr-FR', 'pt-BR')
    expect(make().svc.getLocale().active).toBe('pt')
  })
})
