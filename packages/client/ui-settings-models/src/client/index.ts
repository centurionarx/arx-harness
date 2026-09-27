/**
 * Models settings and product-onboarding plugin, browser half. It registers
 * the Models page plus three onboarding steps — the internal-testing notice,
 * the home-migration notice, and the guide shown while no provider is usable
 * — whose UI uses this package's modal wrapper. The Host settings and
 * credential contracts stay behind their existing wire APIs.
 * Export discipline:
 * packages/client/AGENTS.md.
 */
import type { ClientContext } from '@arx-ai/arx-client-runtime/client'
import type { ConnectionHandle } from '@arx-ai/arx-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@arx-ai/arx-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@arx-ai/arx-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (settings/credentials invalidations ride the allowlist) into this program.
import type {} from '@arx-ai/arx-api-remotes/client'
import { ChatAuthorization } from './ChatAuthorization.tsx'
import type { ChatAuthorizationInjected } from './ChatAuthorization.tsx'
import { ChatAuthorizationStore } from './chat-authorization-store.ts'
import { NativeAccounts } from './NativeAccounts.tsx'
import type { NativeAccountsInjected } from './NativeAccounts.tsx'
import { NativeAccountsStore } from './native-accounts-store.ts'
import { ModelsSection } from './ModelsSection.tsx'
import type { ModelsSectionInjected } from './ModelsSection.tsx'
import { WelcomeNotice } from './WelcomeNotice.tsx'
import type { WelcomeNoticeInjected } from './WelcomeNotice.tsx'
import { HomeMigrationNotice } from './HomeMigrationNotice.tsx'
import type { HomeMigrationNoticeInjected } from './HomeMigrationNotice.tsx'
import { ProviderGuide } from './ProviderGuide.tsx'
import type { ProviderGuideInjected } from './ProviderGuide.tsx'
import { decodeNoticeSection, AcknowledgedNoticeStore } from './notice-store.ts'
import { ModelsSettingsStore } from './store.ts'
import { createSettingsSchemaOperations } from './schema-operations.ts'
import { en, type ModelsKey } from './locales.ts'
import {
  HOME_MIGRATION_ACK_FIELD, PROVIDER_GUIDE_ACK_FIELD, PROVIDER_GUIDE_VERSION,
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_SETTINGS_NAMESPACE, WELCOME_NOTICE_VERSION,
} from '../onboarding-copy.ts'

export type { ModelsSectionInjected, ModelsSectionProps } from './ModelsSection.tsx'
export type { ModelsKey } from './locales.ts'

declare module '@arx-ai/arx-client-ui-slots' {
  interface SlotMap {
    /**
     * The Models page's chat sign-in card, rendered after the page
     * introduction and before the native accounts card. Register one
     * component that takes no owner props; this package registers the
     * `llm-pi-ai/openai-codex` card, and another registration replaces it.
     * Absent a registration, the page renders its providers without it.
     */
    'settings.models.chatAuthorization': { kind: 'single'; scope: 'root'; owner: {} }
    /**
     * The Models page's native product accounts card, rendered after the chat
     * sign-in card. Register one component that takes no owner props; this
     * package registers the Claude Code and Codex account card, and another
     * registration replaces it. Absent a registration, the page renders its
     * providers without it.
     */
    'settings.models.nativeAccounts': { kind: 'single'; scope: 'root'; owner: {} }
  }
  interface LocaleNamespaceMap {
    /** The Models page + product-onboarding copy. */
    'settings.models': ModelsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.models'
export type { ModelsSettingsState, ProviderRow } from './store.ts'

/**
 * Refetch the page snapshot only after its first load: an unopened Models
 * page must not fetch on background invalidations.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller: ModelsSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope', 'settingsSchema']

/**
 * Register the Models section once the `settings.section` declaration is on
 * the ledger, wire its store to the connection, and keep it fresh on every
 * pushed invalidation (settings, credentials, or provider topology).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en }), 'ui-settings-models: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const schema = createSettingsSchemaOperations(ctx.settingsSchema)
  const controller = new ModelsSettingsStore(connection.api, schema, ctx.settingsScope.describe())
  const accounts = new NativeAccountsStore(connection.api, ctx.settingsScope.describe(), () => { void controller.load() })
  ctx.effect(() => () => { accounts.dispose() }, 'ui-settings-models: native accounts')
  // Enabling Codex chat creates the route the native Codex roster feeds, so the account card re-reads how that route serves it.
  const chatAuthorization = new ChatAuthorizationStore(connection.api, ctx.settingsScope.describe(), () => {
    void controller.load()
    void accounts.load()
  })
  ctx.effect(() => () => { chatAuthorization.dispose() }, 'ui-settings-models: chat authorization')
  // Registration-time text (the nav label thunk) and the inject faces share
  // one bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as ModelsSectionInjected['t']
  const injected = (): ModelsSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store },
    api: connection.api,
    schema,
    t,
  })
  // The scope's own memory mode is what keeps a remote browser process-local,
  // so the store needs no isLoopback branch of its own.
  const welcomeController = new AcknowledgedNoticeStore({
    scope: ctx.settingsScope.bind({
      namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE,
      decode: decodeNoticeSection,
    }),
    field: WELCOME_NOTICE_ACK_FIELD,
    version: () => WELCOME_NOTICE_VERSION,
    subject: 'welcome',
  })
  const welcomeInjected = (): WelcomeNoticeInjected => ({
    controller: welcomeController,
    hooks: { welcome: welcomeController.store },
    t,
  })
  // The Host reports one copy per installation, so the instant it happened is
  // the version this notice acknowledges. It is read per comparison because
  // the description arrives after this binding is made.
  const homeMigrationController = new AcknowledgedNoticeStore({
    scope: ctx.settingsScope.bind({
      namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE,
      decode: decodeNoticeSection,
    }),
    field: HOME_MIGRATION_ACK_FIELD,
    version: () => connection.hostDescription.getSnapshot()?.homeMigration?.at ?? '',
    subject: 'home migration',
  })
  const homeMigrationInjected = (): HomeMigrationNoticeInjected => ({
    controller: homeMigrationController,
    hooks: {
      homeMigrationNotice: homeMigrationController.store,
      hostDescription: connection.hostDescription,
    },
    t,
  })
  const providerGuideController = new AcknowledgedNoticeStore({
    scope: ctx.settingsScope.bind({
      namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE,
      decode: decodeNoticeSection,
    }),
    field: PROVIDER_GUIDE_ACK_FIELD,
    version: () => PROVIDER_GUIDE_VERSION,
    subject: 'provider guide',
  })
  // The guide reads the page's own store, so the directory it summarizes is
  // the one the page it opens then shows.
  const providerGuideInjected = (): ProviderGuideInjected => ({
    controller: providerGuideController,
    models: controller,
    schema,
    hooks: { providerGuide: providerGuideController.store, models: controller.store },
    t,
  })

  // Pushed invalidations converge every open surface without polling. The
  // settingsScope injection makes ui-settings activate first, and remote
  // dispatch preserves listener order; its listener therefore starts the
  // mirror refresh before this store joins that refresh. The welcome notice
  // follows its settings scope, so it needs no subscription here.
  ctx.effect(() => {
    const refreshModels = (): void => { refreshIfLoaded(controller) }
    const disposers = [
      ctx.remote.$on('settings/document-updated', () => { refreshModels() }),
      ctx.remote.$on('credentials/reference-updated', refreshModels),
      ctx.remote.$on('llm/adapters-updated', refreshModels),
      ctx.on('connection/reset', refreshModels),
    ]
    return () => {
      welcomeController.dispose()
      homeMigrationController.dispose()
      providerGuideController.dispose()
      for (const dispose of disposers) dispose()
    }
  }, 'ui-settings-models: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'models',
    order: 10,
    label: () => t('nav'),
    inject: injected,
    children: {
      'settings.models.nativeAccounts': { kind: 'single', scope: 'root' },
      'settings.models.chatAuthorization': { kind: 'single', scope: 'root' },
    },
  }, ModelsSection))
  ctx.slots.inject('settings.models.nativeAccounts', () => ctx.slots.register({
    name: 'settings.models.nativeAccounts',
    locale: NS,
    inject: (): NativeAccountsInjected => ({
      available: connection.isLoopback,
      hooks: { accounts: accounts.store, hostDescription: connection.hostDescription },
      watch: () => accounts.watch(),
      reload: () => { void accounts.load() },
      begin: (provider, mode) => { void accounts.begin(provider, mode) },
      cancel: () => { void accounts.cancel() },
      submit: (code) => { void accounts.submit(code) },
      enable: (provider) => { void accounts.enable(provider) },
    }),
  }, NativeAccounts))
  ctx.slots.inject('settings.models.chatAuthorization', () => ctx.slots.register({
    name: 'settings.models.chatAuthorization', locale: NS,
    inject: (): ChatAuthorizationInjected => ({
      available: connection.isLoopback,
      hooks: { authorization: chatAuthorization.store, hostDescription: connection.hostDescription },
      watch: () => chatAuthorization.watch(),
      begin: () => { chatAuthorization.begin() },
      cancel: () => { void chatAuthorization.cancel() },
      submit: (answer) => { chatAuthorization.submit(answer) },
      enable: () => { void chatAuthorization.enable() },
      reload: () => { void chatAuthorization.load() },
    }),
  }, ChatAuthorization))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'welcome-notice',
    order: -100,
    inject: welcomeInjected,
  }, WelcomeNotice))
  // After the welcome notice: a user meeting the product for the first time
  // reads what it is before being told where their old settings went.
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'home-migration-notice',
    order: -90,
    inject: homeMigrationInjected,
  }, HomeMigrationNotice))
  // After both notices: what the product is, and where earlier settings went,
  // come before what it needs in order to start a task.
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'provider-guide',
    order: -50,
    inject: providerGuideInjected,
  }, ProviderGuide))
}
