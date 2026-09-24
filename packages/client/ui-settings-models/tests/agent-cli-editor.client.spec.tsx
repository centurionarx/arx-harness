// @vitest-environment jsdom
/**
 * The Models page card for a CLI-backed route: added and edited with no key,
 * endpoint, or protocol, and refused until it lists a model it can serve. The
 * route's name is whatever the directory sends — the card holds no vendor
 * name of its own, which is why these fixtures use a neutral one.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@arx-ai/schemastery'
import { bindSnapshotSelector } from '@arx-ai/arx-client-test-runtime'
import type { RpcResponse, SettingsNamespaceView } from '@arx-ai/arx-api-remotes/client'
import { SettingsDescribeMirror } from '@arx-ai/arx-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSection } from '../src/client/ModelsSection.tsx'
import type { ModelsSectionInjected, ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { deriveKeyRef, ModelsSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t: ModelsSectionInjected['t'] = key => en[key]

/** The CLI-backed adapter's section, as its plugin registers it. */
const AgentCliConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    displayName: Schema.string(),
    disposeGraceMs: Schema.number(),
    models: Schema.array(Schema.object({
      id: Schema.string().required(),
      contextWindow: Schema.number().required(),
      maxTokens: Schema.number(),
      name: Schema.string(),
      acceptsImages: Schema.boolean(),
    })),
  })),
  cwd: Schema.string(),
})

/** A pi-ai section beside it, so the add card has more than one provider to order. */
const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({ apiKeyEnv: Schema.string().role('credential-ref') })),
})

const ROUTE = 'cli-subscription'
const ROUTE_NAME = 'Example (subscription)'
const PATH = ['providers', ROUTE]
const MODEL = { id: 'model-a', contextWindow: 200_000 }

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}

interface Layers {
  /** The route's profile in the layer this page writes. */
  user?: Record<string, unknown>
  /** The route's profile as a composition pinned it beneath the user's. */
  base?: Record<string, unknown>
  /** Whether the adapter reports the route as declared by configuration. */
  declared?: boolean
}

function namespaces({ user, base }: Layers): SettingsNamespaceView[] {
  const profile = (layer: Record<string, unknown> | undefined): Record<string, unknown> =>
    layer === undefined ? {} : { [ROUTE]: layer }
  return [
    {
      ns: 'llm-agent-cli',
      schema: JSON.parse(JSON.stringify(AgentCliConfig.toJSON())) as unknown,
      value: { providers: { ...profile(base), ...profile(user) } },
      base: { providers: profile(base) },
      user: { providers: profile(user) },
      applies: 'live',
      secrets: [],
      revision: 2,
    },
    {
      ns: 'llm-pi-ai',
      schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as unknown,
      value: { providers: {} },
      user: { providers: {} },
      applies: 'live',
      secrets: [],
      revision: 0,
    },
  ]
}

async function mount(layers: Layers = {}) {
  const views = namespaces(layers)
  const configured = layers.user !== undefined || layers.base !== undefined
  const mutate = vi.fn(() => Promise.resolve(ok(views[0])))
  const setCredential = vi.fn(() => Promise.resolve(ok({})))
  const describeCredentials = vi.fn((payload: { refs: string[] }) => Promise.resolve(ok({
    credentials: Object.fromEntries(payload.refs.map(ref => [ref, { configured: false, writable: true }])),
  })))
  const discover = vi.fn(() => Promise.resolve(ok({ models: [{ id: 'model-b', name: 'Model B' }] })))
  const face = {
    llm: {
      providers: vi.fn(() => Promise.resolve(ok({
        providers: [
          // First in the directory, as the CLI-backed plugin's entry is: it
          // registers at mount, before the pi-ai catalog lands.
          {
            provider: ROUTE,
            displayName: ROUTE_NAME,
            settingsNs: 'llm-agent-cli',
            settingsPath: PATH,
            active: configured,
            declared: layers.declared ?? false,
          },
          { provider: 'zeta', displayName: 'zeta', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'zeta'], active: false },
          { provider: 'alpha', displayName: 'alpha', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'alpha'], active: false },
        ],
      }))),
      models: vi.fn(() => Promise.resolve(ok({ groups: [], failures: [] }))),
      discoverModels: discover,
    },
    settings: {
      describe: vi.fn(() => Promise.resolve(ok({ writable: true, namespaces: views }))),
      update: vi.fn(),
      replace: vi.fn(),
      mutate,
    },
    credentials: { describe: describeCredentials, set: setCredential, unset: vi.fn() },
  }
  const controller = new ModelsSettingsStore(
    face as never, settingsSchema, new SettingsDescribeMirror(face as never))
  await controller.load()
  const props: ModelsSectionProps = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    api: face as never,
    schema: settingsSchema,
    t,
  }
  render(<ModelsSection {...props} />)
  return { mutate, setCredential, describeCredentials, discover }
}

/** Open the add card and pick the CLI-backed route in it. */
async function addRoute(): Promise<void> {
  fireEvent.click(screen.getByText(en.add))
  const pick = await screen.findByLabelText<HTMLSelectElement>(en.provider)
  fireEvent.change(pick, { target: { value: ROUTE } })
  await screen.findByText(en.agentCliCaption)
}

/** Open the edit card of the configured CLI-backed route. */
async function editRoute(): Promise<void> {
  const row = (await screen.findByText(ROUTE_NAME)).closest('li')
  if (row === null) throw new Error('no row for the route')
  fireEvent.click(within(row).getByText(en.edit))
  await screen.findByText(en.agentCliCaption)
}

function applyButton(): HTMLButtonElement {
  return screen.getByText<HTMLButtonElement>(en.apply)
}

/** Add one model row and fill its id and context window. */
function fillModel(id: string, contextWindow: string): void {
  fireEvent.click(screen.getByText(en.addModel))
  const rows = screen.getAllByLabelText(new RegExp(`^${en.modelId} \\d+$`))
  const index = rows.length
  fireEvent.change(screen.getByLabelText(`${en.modelId} ${String(index)}`), { target: { value: id } })
  fireEvent.change(screen.getByLabelText(`${en.modelContextWindow} ${String(index)}`), {
    target: { value: contextWindow },
  })
}

describe('adding a CLI-backed route', () => {
  it('orders the providers it offers by name, so registration order picks no default', async () => {
    await mount()
    fireEvent.click(screen.getByText(en.add))
    const pick = await screen.findByLabelText<HTMLSelectElement>(en.provider)

    expect([...pick.options].map(option => option.textContent)).toEqual(['alpha', ROUTE_NAME, 'zeta'])
    expect(pick.value).toBe('alpha')
  })

  it('asks for no key, endpoint, or protocol, and names the terms it runs under', async () => {
    const { describeCredentials } = await mount()
    await addRoute()

    expect(screen.getByText(en.agentCliTerms)).toBeTruthy()
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
    expect(screen.queryByLabelText(en.baseUrl)).toBeNull()
    expect(screen.queryByLabelText(en.customApi)).toBeNull()
    expect(screen.queryByText(en.customized)).toBeNull()
    // The route has no key, so the card never asks about one.
    const described = describeCredentials.mock.calls.flatMap(([payload]) => payload.refs)
    expect(described).not.toContain(deriveKeyRef(ROUTE))
  })

  it('refuses to apply until the route lists a model and leaves its context window to the catalog', async () => {
    const { mutate } = await mount()
    await addRoute()

    // Nothing listed: the route would serve nothing, and it refuses an
    // unlisted model rather than sending it, so the pi-ai line is not shown.
    expect(applyButton().disabled).toBe(true)
    expect(screen.getByText(en.agentCliNeedsModels)).toBeTruthy()
    expect(screen.queryByText(en.modelsEmpty)).toBeNull()

    fireEvent.click(screen.getByText(en.addModel))
    fireEvent.change(screen.getByLabelText(`${en.modelId} 1`), { target: { value: 'model-a' } })
    // A model outside the installed catalog must state its window, so the
    // field is not folded; a catalog model inherits one, so it is optional.
    expect(screen.queryByLabelText(`${en.modelAdvanced} 1`)).toBeNull()
    expect(screen.getByLabelText(`${en.modelContextWindow} 1`)).toBeTruthy()
    expect(applyButton().disabled).toBe(false)
    expect(screen.queryByText(en.agentCliNeedsModels)).toBeNull()

    fireEvent.click(applyButton())
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
  })

  it('writes the models and nothing else, storing no credential', async () => {
    const { mutate, setCredential } = await mount()
    await addRoute()
    fillModel('model-a', '200K')
    fireEvent.click(screen.getByLabelText(`${en.modelAcceptsImages} 1`))

    fireEvent.click(applyButton())

    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate).toHaveBeenCalledWith({
      ns: 'llm-agent-cli',
      expectedRevision: 2,
      ops: [{ op: 'set', path: [...PATH, 'models'], value: [{ id: 'model-a', contextWindow: 200_000, acceptsImages: true }] }],
    })
    expect(setCredential).not.toHaveBeenCalled()
  })

  it('drops the image flag when it is unchecked rather than storing false', async () => {
    const { mutate } = await mount()
    await addRoute()
    fillModel('model-a', '200K')
    const images = screen.getByLabelText<HTMLInputElement>(`${en.modelAcceptsImages} 1`)
    fireEvent.click(images)
    fireEvent.click(images)
    expect(images.checked).toBe(false)

    fireEvent.click(applyButton())

    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      ops: [{ op: 'set', path: [...PATH, 'models'], value: [{ id: 'model-a', contextWindow: 200_000 }] }],
    }))
  })

  it('asks the route’s own discovery for candidates, with no endpoint or key', async () => {
    const { discover } = await mount()
    await addRoute()

    fireEvent.click(screen.getByText(en.fetchModels))

    await waitFor(() => { expect(discover).toHaveBeenCalledOnce() })
    expect(discover).toHaveBeenCalledWith({ settingsNs: 'llm-agent-cli', provider: ROUTE })
  })
})

describe('editing a configured CLI-backed route', () => {
  it('offers nothing to restore when no layer beneath the user’s pins models', async () => {
    await mount({ user: { models: [MODEL] } })
    await editRoute()

    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`).value).toBe('model-a')
    expect(screen.queryByText(en.resetModels)).toBeNull()
    expect(screen.queryByText(en.modelsCustomized)).toBeNull()
  })

  it('restores the models the composition pinned beneath the user’s', async () => {
    await mount({ base: { models: [MODEL] }, user: { models: [{ id: 'model-c', contextWindow: 100_000 }] } })
    await editRoute()
    expect(screen.getByText(en.modelsCustomized)).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`).value).toBe('model-c')

    fireEvent.click(screen.getByText(en.resetModels))

    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`).value).toBe('model-a')
    expect(screen.getByText(en.modelsInherited)).toBeTruthy()
  })

  it('offers the display name only for a route its configuration declared', async () => {
    await mount({ user: { models: [MODEL] }, declared: true })
    await editRoute()

    fireEvent.change(screen.getByLabelText(en.customDisplayName), { target: { value: 'Team route' } })
    expect(screen.getByLabelText<HTMLInputElement>(en.customDisplayName).value).toBe('Team route')
  })

  it('leaves an offered route’s name to the product that offers it', async () => {
    await mount({ user: { models: [MODEL] } })
    await editRoute()

    expect(screen.queryByLabelText(en.customDisplayName)).toBeNull()
  })
})
