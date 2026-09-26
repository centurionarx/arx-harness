/** Models section registration: slot declaration injection, the locale-following label thunk, and HMR recovery. */
import { Context } from '@arx-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@arx-ai/arx-client-ui-slots'
import { SlotRegistry } from '@arx-ai/arx-client-runtime/client'
import { LocaleRuntime } from '@arx-ai/arx-client-locale/client'
import { TestRemote } from '@arx-ai/arx-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@arx-ai/arx-client-ui-settings/client'
import { apply, inject, refreshIfLoaded } from '@arx-ai/arx-client-ui-settings-models/client'
import {
  PROVIDER_GUIDE_ACK_FIELD, PROVIDER_GUIDE_VERSION,
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_SETTINGS_NAMESPACE, WELCOME_NOTICE_VERSION,
} from '../src/onboarding-copy.ts'
import type { HostDescription } from '@arx-ai/arx-client-connection/client'
import { ModelsSection } from '../src/client/ModelsSection.tsx'
import { WelcomeNotice } from '../src/client/WelcomeNotice.tsx'
import { HomeMigrationNotice } from '../src/client/HomeMigrationNotice.tsx'
import { ProviderGuide } from '../src/client/ProviderGuide.tsx'
import { NativeAccounts, type NativeAccountsInjected } from '../src/client/NativeAccounts.tsx'
import { ChatAuthorization, type ChatAuthorizationInjected } from '../src/client/ChatAuthorization.tsx'

// These specs assert the shipped English copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en), the only locale the client ships.

/** The Host facts every description carries, beside the copy under test. */
const HOST: HostDescription = {
  version: '1.0.10',
  cwd: '/workspace',
  attachedSessions: 0,
  home: '/home/tester',
  canOpenPath: false,
}

/** A host-description source answering one fixed description, as the wire root exposes. */
function describing(homeMigration?: HostDescription['homeMigration']) {
  const description: HostDescription | undefined = homeMigration === undefined
    ? undefined
    : { ...HOST, homeMigration }
  return { getSnapshot: () => description, subscribe: () => () => {} }
}

async function bench(
  isLoopback = true,
  settings?: object,
  services: object = {},
  hostDescription = describing(),
) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  // The plugins inject `remote`; forwarded events reach them through the
  // same `$dispatch` handoff the connection sink makes.
  new TestRemote(ctx)
  // Without a settings face the mirror's reads fail and stay contained; the
  // Models join itself never fetches until a section actually loads. The real
  // ui-settings apply also provides the settingsSchema service.
  ctx.provide('connection', {
    api: settings === undefined ? services : { ...services, settings },
    isLoopback,
    hostDescription,
  } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.onboarding': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

/** A settings face whose onboarding namespace records one acknowledged copy instant. */
function onboardingFace(acknowledgedAt: string | undefined) {
  return onboardingSection(acknowledgedAt === undefined ? {} : { homeMigrationNoticedAt: acknowledgedAt })
}

/** A settings face whose onboarding namespace holds exactly `value`. */
function onboardingSection(value: Record<string, string>) {
  return {
    describe: vi.fn(() => Promise.resolve({
      rpcId: 'apply-home-migration' as never,
      result: {
        ok: true as const,
        value: {
          writable: true,
          hasDocument: false,
          namespaces: [{
            ns: WELCOME_NOTICE_SETTINGS_NAMESPACE,
            schema: {},
            value,
            applies: 'live' as const,
            secrets: [],
            revision: 0,
          }],
        },
      },
    })),
  }
}

/** The home-migration step's injected face, from the onboarding slot. */
function homeMigrationFace(slots: SlotRegistry) {
  const entry = slots.entries('settings.onboarding')
    .find(candidate => candidate.options.id === 'home-migration-notice')!
  return (
    entry.inject as unknown as
    () => import('../src/client/HomeMigrationNotice.tsx').HomeMigrationNoticeInjected
  )()
}

describe('ui-settings-models apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope', 'settingsSchema'])
  })

  it('registers the models nav entry for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = before.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(ModelsSection)
    expect(entry.options).toMatchObject({ id: 'models', order: 10 })
    // The nav label is a locale-following thunk; owners resolve at read time.
    expect(resolveSlotLabel(entry.options.label)).toBe('Models')
    const injected = (entry.inject as unknown as () => import('../src/client/ModelsSection.tsx').ModelsSectionInjected)()
    expect(injected.t('nav')).toBe('Models')
    expect(injected.t('deleteTitle')).toBe('Delete {provider}?')
    expect(typeof injected.controller.load).toBe('function')
    expect(injected.hooks.snapshot).toBe(injected.controller.store)
    expect(injected.api).toBeDefined()
    const onboarding = before.slots.entries('settings.onboarding')
    expect(onboarding).toHaveLength(3)
    expect(onboarding.find(entry => entry.options.id === 'welcome-notice')).toMatchObject({
      component: WelcomeNotice,
      options: { id: 'welcome-notice', order: -100 },
    })
    // The welcome notice comes first: a user meeting the product reads what it
    // is before being told where their previous settings went.
    expect(onboarding.find(entry => entry.options.id === 'home-migration-notice')).toMatchObject({
      component: HomeMigrationNotice,
      options: { id: 'home-migration-notice', order: -90 },
    })
    // Both notices come before the guide to what the product needs to start.
    expect(onboarding.find(entry => entry.options.id === 'provider-guide')).toMatchObject({
      component: ProviderGuide,
      options: { id: 'provider-guide', order: -50 },
    })

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('settings.section')).toHaveLength(0)
    expect(after.slots.entries('settings.onboarding')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('settings.section')[0]!.component).toBe(ModelsSection)
    expect(after.slots.entries('settings.onboarding')).toHaveLength(3)
    // The self-inflicted ledger notifications hit the duplicate guard.
    expect(after.slots.entries('settings.section')).toHaveLength(1)
  })

  it('the label thunk follows the active locale without re-registration', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.locale.setLocale('en')
    // Registration stores the thunk itself, not the text it resolved to.
    expect(typeof b.slots.entries('settings.section')[0]!.options.label).toBe('function')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Models')
    const injected = b.slots.entries('settings.section')[0]!.inject as unknown as () => import('../src/client/ModelsSection.tsx').ModelsSectionInjected
    expect(injected().t('deleteTitle')).toBe('Delete {provider}?')
  })

  it('locale change while the slot is undeclared stays a no-op', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.locale.setLocale('en')
    expect(b.slots.entries('settings.section')).toHaveLength(0)
  })

  it('re-registers after an HMR collapse re-declares the slot (stale disposer must not block)', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    // Declarer unload: the cascade removes our entry while our local
    // disposer variable goes stale.
    redeclare()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('settings.onboarding')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('settings.section')[0]!.component).toBe(ModelsSection)
    expect(b.slots.entries('settings.onboarding')).toHaveLength(3)
    // The locale path also recovers through the same ledger re-check.
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Models')
  })

  it('registers the nav dictionary and disposes everything with the fiber', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('settings.models')('nav')).toBe('Models')
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('settings.onboarding')).toHaveLength(0)
    // The (ns, locale) seat is free again — the dictionary disposer ran.
    expect(() => b.locale.register('settings.models', 'en', {})).not.toThrow()
  })

  it('keeps remote-browser acknowledgement in process memory', async () => {
    const b = await bench(false)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'welcome-notice')!
    const injected = (
      entry.inject as unknown as () => import('../src/client/WelcomeNotice.tsx').WelcomeNoticeInjected
    )()

    await injected.controller.load()
    expect(injected.controller.store.getSnapshot()).toEqual({
      status: 'ready', acknowledged: false, error: null,
    })
  })

  it('acknowledges the home copy by the instant the Host reports for it', async () => {
    const migration = { fromDisplay: '~/.cxh', toDisplay: '~/.arx', at: '2026-09-22T10:00:00.000Z' }
    // Durable scope: the acknowledged instant is compared against the Host's,
    // which is what the memory-mode branch never reaches.
    const b = await bench(true, onboardingFace(migration.at), {}, describing(migration))
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = homeMigrationFace(b.slots)

    expect(injected.hooks.homeMigrationNotice).toBe(injected.controller.store)
    expect(injected.hooks.hostDescription.getSnapshot()?.homeMigration).toEqual(migration)
    await injected.controller.load()
    await vi.waitFor(() => {
      expect(injected.hooks.homeMigrationNotice.getSnapshot()).toMatchObject({ acknowledged: true })
    })
  })

  it('leaves an older acknowledged instant unmatched by a newer copy', async () => {
    const migration = { fromDisplay: '~/.cxh', toDisplay: '~/.arx', at: '2026-09-22T10:00:00.000Z' }
    const b = await bench(true, onboardingFace('2020-01-01T00:00:00.000Z'), {}, describing(migration))
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = homeMigrationFace(b.slots)

    await injected.controller.load()
    await vi.waitFor(() => {
      expect(injected.hooks.homeMigrationNotice.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: false })
    })
  })

  it('hands the guide the Models page store and its own dismissal controller', async () => {
    const b = await bench(false)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const models = (
      b.slots.entries('settings.section')[0]!.inject as unknown as
      () => import('../src/client/ModelsSection.tsx').ModelsSectionInjected
    )()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'provider-guide')!
    const injected = (
      entry.inject as unknown as () => import('../src/client/ProviderGuide.tsx').ProviderGuideInjected
    )()

    // One directory read serves the guide and the page it opens.
    expect(injected.models).toBe(models.controller)
    expect(injected.hooks.models).toBe(models.controller.store)
    expect(injected.hooks.providerGuide).toBe(injected.controller.store)
    expect(injected.t('providerGuideOpen')).toBe('Open Models settings')
    await injected.controller.load()
    expect(injected.controller.store.getSnapshot()).toEqual({ status: 'ready', acknowledged: false, error: null })
  })

  it('reads the guide as dismissed where the current guide version is stored', async () => {
    const b = await bench(true, onboardingSection({ [PROVIDER_GUIDE_ACK_FIELD]: PROVIDER_GUIDE_VERSION }))
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'provider-guide')!
    const injected = (
      entry.inject as unknown as () => import('../src/client/ProviderGuide.tsx').ProviderGuideInjected
    )()

    await injected.controller.load()
    await vi.waitFor(() => {
      expect(injected.hooks.providerGuide.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: true })
    })
  })

  it('holds no copy instant on an installation that migrated nothing', async () => {
    const b = await bench(true, onboardingFace(undefined))
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const injected = homeMigrationFace(b.slots)

    expect(injected.hooks.hostDescription.getSnapshot()).toBeUndefined()
    await injected.controller.load()
    await vi.waitFor(() => {
      expect(injected.hooks.homeMigrationNotice.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: false })
    })
  })
})

describe('pushed invalidations', () => {
  it('composes chat sign-in and native accounts under the Models page and reloads it after enabling a route', async () => {
    const reply = <T>(value: T) => Promise.resolve({ rpcId: 'apply-accounts' as never, result: { ok: true as const, value } })
    const namespace = (ns: string) => ({ ns, schema: {}, value: { providers: {} }, applies: 'live' as const, secrets: [], revision: 1 })
    const settings = {
      describe: vi.fn(() => reply({ writable: true, hasDocument: false, namespaces: [namespace('llm-agent-cli'), namespace('llm-pi-ai')] })),
      mutate: vi.fn((request: { ns: string; ops: { path: string[] }[] }) =>
        reply({ ...namespace(request.ns), revision: 2, value: { providers: { [request.ops[0]!.path[1]!]: {} } } })),
    }
    const settled = { id: 'settled' as never, provider: 'claude-code' as const, state: 'cancelled' as const, expiresAt: 0, pollAfterMs: 1000 }
    const nativeAccounts = {
      describe: vi.fn(() => reply({ accounts: [{ provider: 'claude-code', label: 'Claude Code', availability: 'available', status: 'connected',
        authMode: 'subscription', loginModes: ['browser'], loginInFlight: false, models: [{ id: 'sonnet', name: 'Sonnet' }] }] })),
      begin: vi.fn(() => reply({ attempt: settled })), poll: vi.fn(), submit: vi.fn(), cancel: vi.fn(),
    }
    const flow = { key: 'llm-pi-ai/openai-codex', label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'Sign in' }],
      inFlight: false, configured: true, writable: true, kind: 'grant' }
    const authorization = {
      describe: vi.fn(() => reply({ flows: [flow] })),
      begin: vi.fn(() => reply({ attempt: { id: 'settled' as never, key: flow.key, state: 'cancelled', expiresAt: 0, pollAfterMs: 1000 } })),
      poll: vi.fn(), submit: vi.fn(), cancel: vi.fn(),
    }
    const llm = { providers: vi.fn(() => reply({ providers: [] })) }
    const b = await bench(true, settings, { nativeAccounts, authorization, llm })
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const nativeEntry = b.slots.entries('settings.models.nativeAccounts')[0]!
    const chatEntry = b.slots.entries('settings.models.chatAuthorization')[0]!
    expect([nativeEntry.component, chatEntry.component]).toEqual([NativeAccounts, ChatAuthorization])
    const native = (nativeEntry.inject as unknown as () => NativeAccountsInjected)()
    const chat = (chatEntry.inject as unknown as () => ChatAuthorizationInjected)()
    expect([native.available, chat.available]).toEqual([true, true])
    // Both sign-in cards read the connection's host facts to tell a host without a desktop session.
    expect(native.hooks.hostDescription).toBe(chat.hooks.hostDescription)

    native.watch()()
    native.reload()
    await vi.waitFor(() => { expect(native.hooks.accounts.getSnapshot()).toMatchObject({ loading: false, accounts: [{ status: 'connected' }] }) })
    expect(nativeAccounts.describe).toHaveBeenCalledTimes(2)
    native.enable('claude-code')
    await vi.waitFor(() => { expect(llm.providers).toHaveBeenCalledOnce() })
    expect(settings.mutate).toHaveBeenCalledWith(expect.objectContaining({ ns: 'llm-agent-cli' }))
    native.begin('claude-code', 'browser')
    await vi.waitFor(() => { expect(nativeAccounts.begin).toHaveBeenCalledWith({ provider: 'claude-code', mode: 'browser' }) })
    native.submit('unrequested')
    native.cancel()

    chat.watch()()
    chat.reload()
    await vi.waitFor(() => { expect(authorization.describe).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => { expect(chat.hooks.authorization.getSnapshot().flow?.key).toBe(flow.key) })
    chat.begin()
    await vi.waitFor(() => { expect(authorization.begin).toHaveBeenCalledWith({ key: flow.key, method: 'oauth' }) })
    chat.submit('unrequested')
    chat.cancel()
    const accountReads = nativeAccounts.describe.mock.calls.length
    chat.enable()
    await vi.waitFor(() => { expect(llm.providers).toHaveBeenCalledTimes(2) })
    expect(settings.mutate).toHaveBeenCalledWith(expect.objectContaining({ ns: 'llm-pi-ai' }))
    // The route chat authorization just created is the one the Codex roster feeds, so the account card re-reads it.
    await vi.waitFor(() => { expect(nativeAccounts.describe).toHaveBeenCalledTimes(accountReads + 1) })
    expect([nativeAccounts.submit, nativeAccounts.cancel, authorization.submit, authorization.cancel].map(fn => fn.mock.calls.length))
      .toEqual([0, 0, 0, 0])
    await b.ctx.fiber.dispose()
  })

  it('ignores invalidations before the page ever loaded', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // The fake wire face has no methods: a fetch attempt would throw.
    b.ctx.remote.$dispatch('settings/document-updated', ['llm-pi-ai', 1])
    b.ctx.remote.$dispatch('credentials/reference-updated', ['OPENAI_API_KEY'])
    b.ctx.remote.$dispatch('llm/adapters-updated', [])
    b.ctx.emit('connection/reset')
  })

  it('refreshes a loaded page and skips an idle one', () => {
    const loads: number[] = []
    const controller = {
      store: { getSnapshot: () => ({ status: 'ready' }) },
      load: () => { loads.push(1); return Promise.resolve() },
    }
    refreshIfLoaded(controller as unknown as import('../src/client/store.ts').ModelsSettingsStore)
    expect(loads).toHaveLength(1)
    const idle = {
      store: { getSnapshot: () => ({ status: 'idle' }) },
      load: () => { loads.push(2); return Promise.resolve() },
    }
    refreshIfLoaded(idle as unknown as import('../src/client/store.ts').ModelsSettingsStore)
    expect(loads).toHaveLength(1)
  })

  it('routes pushed credential invalidation into the shared Models join', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')
      .find(candidate => candidate.options.id === 'models')!
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/ModelsSection.tsx').ModelsSectionInjected
    )()
    injected.controller.store.update((state) => { state.status = 'ready' })
    const load = vi.spyOn(injected.controller, 'load').mockResolvedValue()
    b.ctx.remote.$dispatch('credentials/reference-updated', ['OPENAI_API_KEY'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('welcome state follows the shared mirror across document commits', async () => {
    // The welcome notice derives from its settings scope: a document commit
    // reaches it through the mirror's one refresh, with no routing here.
    const acknowledgement = { current: undefined as string | undefined }
    const settings = {
      describe: vi.fn(() => Promise.resolve({
        rpcId: 'apply-welcome' as never,
        result: {
          ok: true as const,
          value: {
            writable: true,
            hasDocument: false,
            namespaces: [{
              ns: WELCOME_NOTICE_SETTINGS_NAMESPACE,
              schema: {},
              value: acknowledgement.current === undefined ? {} : { [WELCOME_NOTICE_ACK_FIELD]: acknowledgement.current },
              applies: 'live' as const,
              secrets: [],
              revision: 0,
            }],
          },
        },
      })),
    }
    const b = await bench(true, settings)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.onboarding')
      .find(candidate => candidate.options.id === 'welcome-notice')!
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/WelcomeNotice.tsx').WelcomeNoticeInjected
    )()
    await injected.controller.load()
    await vi.waitFor(() => {
      expect(injected.hooks.welcome.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: false })
    })
    acknowledgement.current = WELCOME_NOTICE_VERSION
    b.ctx.remote.$dispatch('settings/document-updated', ['ui-onboarding', 1])
    await vi.waitFor(() => {
      expect(injected.hooks.welcome.getSnapshot()).toMatchObject({ status: 'ready', acknowledged: true })
    })
  })

  it('joins the refreshed mirror view on a settings invalidation', async () => {
    let revision = 1
    const describe = vi.fn(() => Promise.resolve({
      rpcId: `apply-models-${revision}` as never,
      result: {
        ok: true as const,
        value: {
          writable: true,
          hasDocument: false,
          namespaces: [{
            ns: 'llm-test',
            schema: {},
            value: {},
            applies: 'live' as const,
            secrets: [],
            revision,
          }],
        },
      },
    }))
    const providers = vi.fn(() => Promise.resolve({
      rpcId: 'apply-models-providers' as never,
      result: { ok: true as const, value: { providers: [] } },
    }))
    const b = await bench(true, { describe }, { llm: { providers } })
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')
      .find(candidate => candidate.options.id === 'models')!
    const injected = (
      entry.inject as unknown as
      () => import('../src/client/ModelsSection.tsx').ModelsSectionInjected
    )()
    await injected.controller.load()
    expect(injected.hooks.snapshot.getSnapshot().namespaces.get('llm-test')?.revision).toBe(1)

    revision = 2
    b.ctx.remote.$dispatch('settings/document-updated', ['llm-test', revision])

    await vi.waitFor(() => {
      expect(injected.hooks.snapshot.getSnapshot().namespaces.get('llm-test')?.revision).toBe(2)
    })
    expect(describe).toHaveBeenCalledTimes(2)
  })
})
