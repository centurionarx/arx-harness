// @vitest-environment jsdom
/**
 * The guide shown while no model provider is usable: when it shows and when it
 * completes on its own, what it lists from the provider directory, and its two
 * ways out — each dismisses this version without holding the user in the
 * dialog, and one opens the Models page.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@arx-ai/schemastery'
import { Context } from '@arx-ai/cordis'
import { bindSnapshotSelector } from '@arx-ai/arx-client-test-runtime'
import type { ConfigurableProviderView, RpcResponse } from '@arx-ai/arx-api-remotes/client'
import { SettingsSchemaService } from '@arx-ai/arx-client-ui-settings/src/client/schema.ts'
import { SettingsDescribeMirror } from '@arx-ai/arx-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsScopeController } from '@arx-ai/arx-client-ui-settings/src/client/settings-scope.ts'
import { ProviderGuide } from '../src/client/ProviderGuide.tsx'
import type { ProviderGuideProps } from '../src/client/ProviderGuide.tsx'
import { AcknowledgedNoticeStore, decodeNoticeSection } from '../src/client/notice-store.ts'
import type { NoticeSection } from '../src/client/notice-store.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import {
  PROVIDER_GUIDE_ACK_FIELD, PROVIDER_GUIDE_COPY, PROVIDER_GUIDE_VERSION, WELCOME_NOTICE_SETTINGS_NAMESPACE,
} from '../src/onboarding-copy.ts'
import { settingsSchema } from './settings-schema.client.ts'

/** Stateless schema service for the dismissal scope in this jsdom fixture. */
const schemaService = new SettingsSchemaService(new Context())

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `guide-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string): RpcResponse<T> {
  return { rpcId: `guide-${nextRpc++}` as never, result: { ok: false, error: { code: 'internal', message, details: {} } } }
}

/** The key-bearing adapter's profile as the Host serializes it: enough for its protocol choices. */
const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    api: Schema.union(['openai-completions', 'anthropic-messages']),
  })),
})

/** One directory entry, dormant unless the case says otherwise. */
function entry(
  provider: string,
  settingsNs: string,
  over: Partial<ConfigurableProviderView> = {},
): ConfigurableProviderView {
  return {
    provider,
    displayName: provider,
    settingsNs,
    settingsPath: settingsNs === '' ? [] : ['providers', provider],
    active: false,
    declared: false,
    ...over,
  }
}

/**
 * A directory with nothing usable: two catalog providers, a hand-declared
 * route whose key is missing, two command-line routes, and a namespace with no
 * curated layout.
 */
const NOTHING_USABLE = [
  entry('openai', 'llm-pi-ai'),
  entry('anthropic', 'llm-pi-ai'),
  entry('acme-gateway', 'llm-pi-ai', { displayName: 'Acme Gateway', active: true, declared: true }),
  entry('claude-subscription', 'llm-agent-cli', { displayName: 'Claude (subscription)' }),
  entry('beta-cli', 'llm-agent-cli', { displayName: 'Beta CLI' }),
  entry('other', 'llm-other'),
]

/** The settings namespaces behind {@link NOTHING_USABLE}, beside the onboarding one. */
function namespaces(acknowledged: string | undefined, piAi = true) {
  const view = (ns: string, value: unknown, schema: unknown = {}) => ({
    ns, schema, value, base: {}, user: value, applies: 'live' as const, secrets: [], revision: 0,
  })
  return [
    view(WELCOME_NOTICE_SETTINGS_NAMESPACE, acknowledged === undefined ? {} : { [PROVIDER_GUIDE_ACK_FIELD]: acknowledged }),
    ...piAi
      ? [view(
        'llm-pi-ai',
        { providers: { 'acme-gateway': { apiKeyEnv: 'ACME_GATEWAY_API_KEY', api: 'openai-completions' } } },
        JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as unknown,
      )]
      : [],
    view('llm-agent-cli', {}),
  ]
}

function mount(options: {
  directory?: readonly ConfigurableProviderView[]
  providers?: () => Promise<RpcResponse<{ providers: readonly ConfigurableProviderView[] }>>
  acknowledged?: string
  piAi?: boolean
  mutate?: () => Promise<unknown>
} = {}) {
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.append(appRoot)
  const providers = vi.fn(options.providers
    ?? (() => Promise.resolve(ok({ providers: options.directory ?? NOTHING_USABLE }))))
  const mutate = vi.fn(options.mutate ?? (() => Promise.resolve(ok({
    ...namespaces(PROVIDER_GUIDE_VERSION, options.piAi)[0]!,
    revision: 1,
  }))))
  const api = {
    llm: { providers },
    settings: {
      describe: () => Promise.resolve(ok({
        writable: true,
        hasDocument: false,
        namespaces: namespaces(options.acknowledged, options.piAi),
      })),
      mutate,
    },
    credentials: {
      describe: (payload: { refs: string[] }) => Promise.resolve(ok({
        credentials: Object.fromEntries(payload.refs.map(ref => [ref, { configured: false, writable: true }])),
      })),
    },
  }
  const mirror = new SettingsDescribeMirror(api as never)
  const scope = new SettingsScopeController<NoticeSection>(
    api as never,
    { namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE, decode: decodeNoticeSection },
    mirror,
    'host',
    schemaService,
  )
  const controller = new AcknowledgedNoticeStore({
    scope,
    field: PROVIDER_GUIDE_ACK_FIELD,
    version: () => PROVIDER_GUIDE_VERSION,
    subject: 'provider guide',
  })
  const models = new ModelsSettingsStore(api as never, settingsSchema, mirror)
  void mirror.load()
  const complete = vi.fn()
  const openSection = vi.fn()
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: ProviderGuideProps = {
    stepId: 'provider-guide',
    complete,
    openSection,
    useSessions: unusedHook,
    useWorkspaces: unusedHook,
    controller,
    models,
    schema: settingsSchema,
    useProviderGuide: bindSnapshotSelector(controller.store),
    useModels: bindSnapshotSelector(models.store),
    t: key => en[key],
  }
  return { ...render(<ProviderGuide {...props} />), complete, openSection, providers, mutate, models, mirror, appRoot }
}

/** Let the mirror, the dismissal scope, and the directory join settle. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
  })
}

describe('ProviderGuide', () => {
  it('lists what the directory offers without naming a provider itself', async () => {
    const h = mount()
    const dialog = await screen.findByRole('dialog', { name: PROVIDER_GUIDE_COPY.en.title })
    expect(screen.getByText(PROVIDER_GUIDE_COPY.en.body)).toBeTruthy()
    expect(screen.getByText(PROVIDER_GUIDE_COPY.en.offersLead)).toBeTruthy()
    // Catalog providers counted, the declared route left out; the command-line
    // routes by name, sorted and each once; the unknown namespace contributes
    // nothing.
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      '2 hosted providers, reached with an API key or cloud credentials',
      'Any service with an OpenAI-compatible API',
      'Beta CLI, through its command-line tool signed in on this machine',
      'Claude (subscription), through its command-line tool signed in on this machine',
    ])
    expect(dialog.querySelectorAll('button')).toHaveLength(2)
    expect(h.appRoot.inert).toBe(true)
  })

  it('opens the Models page and dismisses this version', async () => {
    const h = mount()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: PROVIDER_GUIDE_COPY.en.open }))
    expect(h.openSection).toHaveBeenCalledWith('models')
    expect(h.complete).toHaveBeenCalledOnce()
    await settle()
    expect(h.mutate).toHaveBeenCalledOnce()
    expect(h.mutate.mock.calls[0]).toEqual([expect.objectContaining({
      ns: WELCOME_NOTICE_SETTINGS_NAMESPACE,
      ops: [{ op: 'set', path: [PROVIDER_GUIDE_ACK_FIELD], value: PROVIDER_GUIDE_VERSION }],
    })])
    // The acknowledgement settling later does not complete the step twice.
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('leaves for later without opening settings', async () => {
    const h = mount()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: PROVIDER_GUIDE_COPY.en.later }))
    expect(h.openSection).not.toHaveBeenCalled()
    expect(h.complete).toHaveBeenCalledOnce()
    await settle()
    expect(h.mutate).toHaveBeenCalledOnce()
  })

  it('never holds the user when the dismissal does not persist', async () => {
    const h = mount({ mutate: () => Promise.resolve(fail('read only')) })
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: PROVIDER_GUIDE_COPY.en.later }))
    expect(h.complete).toHaveBeenCalledOnce()
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('completes without showing when a provider is usable', async () => {
    const h = mount({
      directory: [...NOTHING_USABLE, entry('claude-own', 'llm-agent-cli', { active: true, declared: true })],
    })
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('completes without showing when the directory cannot answer', async () => {
    const h = mount({ providers: () => Promise.resolve(fail('adapter registry unavailable')) })
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('skips a dismissed version without reading the directory', async () => {
    const h = mount({ acknowledged: PROVIDER_GUIDE_VERSION })
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.providers).not.toHaveBeenCalled()
  })

  it('shows again once the guide version moves past the dismissed one', async () => {
    const h = mount({ acknowledged: '2020-01-01.1' })
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('names a lone catalog provider in the singular and leaves out what is not mounted', async () => {
    mount({ directory: [entry('openai', 'llm-pi-ai')], piAi: false })
    await screen.findByRole('dialog')
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'One hosted provider, reached with an API key or cloud credentials',
    ])
  })

  it('drops the list when the directory offers nothing', async () => {
    mount({ directory: [], piAi: false })
    await screen.findByRole('dialog')
    expect(screen.queryByText(PROVIDER_GUIDE_COPY.en.offersLead)).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('stays open while the directory refreshes underneath it', async () => {
    let refresh!: (value: RpcResponse<{ providers: readonly ConfigurableProviderView[] }>) => void
    let calls = 0
    const h = mount({
      providers: () => {
        calls += 1
        return calls === 1
          ? Promise.resolve(ok({ providers: NOTHING_USABLE }))
          : new Promise((resolve) => { refresh = resolve })
      },
    })
    await screen.findByRole('dialog')
    void h.models.load()
    await settle()
    expect(h.models.store.getSnapshot().status).toBe('loading')
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => {
      refresh(ok({ providers: NOTHING_USABLE }))
      await Promise.resolve()
    })
    expect(h.complete).not.toHaveBeenCalled()
  })
})
