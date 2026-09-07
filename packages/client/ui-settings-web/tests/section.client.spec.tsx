// @vitest-environment jsdom
/** The section over a real store: rows, dots, the selection, and the key form. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector } from '@arx-ai/arx-client-test-runtime'
import type { RpcResponse } from '@arx-ai/arx-api-remotes/client'
import { SettingsDescribeMirror } from '@arx-ai/arx-client-ui-settings/src/client/settings-mirror.ts'
import { fill, WebSection } from '../src/client/WebSection.tsx'
import type { WebSectionInjected, WebSectionProps } from '../src/client/WebSection.tsx'
import { WebSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: WebSectionInjected['t'] = key => en[key]

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: false, error: { code: 'internal', message, details: {} } } }
}

const PROVIDERS = [
  { provider: 'exa', displayName: 'Exa', settingsNs: 'web-search-exa', settingsPath: [], available: true },
  { provider: 'perplexity', displayName: 'Perplexity', settingsNs: 'web-search-perplexity', settingsPath: [], available: false },
  { provider: 'ghost', displayName: 'ghost', settingsNs: '', settingsPath: [], available: false },
]
const NAMESPACES = [
  { ns: 'web', schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 2 },
  { ns: 'web-search-exa', schema: {}, value: { apiKeyEnv: 'EXA_API_KEY' }, applies: 'live' as const, secrets: [], revision: 0 },
  { ns: 'web-search-perplexity', schema: {}, value: { apiKeyEnv: 'PERPLEXITY_API_KEY' }, applies: 'live' as const, secrets: [], revision: 0 },
]

function bench(options: {
  selection?: { configured?: string; effective?: string; failure?: string }
  writable?: boolean
  credentialWritable?: boolean
  refuseWrites?: boolean
} = {}) {
  const writes: Array<{ kind: string; payload: unknown }> = []
  const write = (kind: string) => (payload: unknown) => {
    writes.push({ kind, payload })
    return Promise.resolve(options.refuseWrites === true ? fail(`${kind} refused`) : ok({}))
  }
  const face = {
    web: { providers: () => Promise.resolve(ok({ providers: PROVIDERS, selection: options.selection ?? { effective: 'exa' } })) },
    settings: {
      describe: () => Promise.resolve(ok({ writable: options.writable ?? true, hasDocument: true, namespaces: NAMESPACES })),
      update: write('update'),
      replace: write('replace'),
      mutate: write('mutate'),
    },
    credentials: {
      describe: (payload: { refs: string[] }) => Promise.resolve(ok({
        credentials: Object.fromEntries(payload.refs.map(ref => [
          ref, { configured: ref === 'EXA_API_KEY', writable: options.credentialWritable ?? true },
        ])),
      })),
      set: write('set'),
      unset: write('unset'),
    },
  } as never
  const controller = new WebSettingsStore(face, new SettingsDescribeMirror(face))
  const props = { controller, useSnapshot: bindSnapshotSelector(controller.store), t } as unknown as WebSectionProps
  render(<WebSection {...props} />)
  return { controller, writes }
}

describe('WebSection', () => {
  it('loads on mount and renders one row per provider with usability and key dots', async () => {
    bench()
    await screen.findAllByText('Exa')
    expect(screen.getAllByText('Perplexity')).toHaveLength(2)
    expect(screen.getAllByLabelText(en.available)).toHaveLength(1)
    expect(screen.getAllByLabelText(en.unavailable)).toHaveLength(2)
    expect(screen.getAllByLabelText(en.credentialConfigured)).toHaveLength(1)
    expect(screen.getAllByLabelText(en.credentialMissing)).toHaveLength(1)
    // A provider with no settings address has no key control and says so.
    expect(screen.getByText(en.noAddress)).toBeTruthy()
    expect(screen.queryByLabelText(fill(en.keyLabel, { provider: 'ghost' }))).toBeNull()
    expect(screen.getByRole('status').textContent).toBe(fill(en.selectionEffective, { provider: 'Exa' }))
  })

  it('pins and unpins the provider through the settings section and reloads', async () => {
    const { writes } = bench({ selection: { configured: 'exa', effective: 'exa' } })
    await screen.findAllByText('Exa')
    const select = screen.getByLabelText(en.selection) as HTMLSelectElement
    expect(select.value).toBe('exa')
    fireEvent.change(select, { target: { value: 'perplexity' } })
    await screen.findByText(en.selectionSaved)
    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() => { expect(writes).toHaveLength(2) })
    expect(writes[0]).toEqual({ kind: 'update', payload: { ns: 'web', patch: { searchProvider: 'perplexity' }, expectedRevision: 2 } })
    expect(writes[1]).toEqual({ kind: 'mutate', payload: { ns: 'web', ops: [{ op: 'unset', path: ['searchProvider'] }], expectedRevision: 2 } })
  })

  it('stores a key under the reference the section names, then removes it', async () => {
    const { writes } = bench()
    await screen.findAllByText('Exa')
    const input = screen.getByLabelText(fill(en.keyLabel, { provider: 'Perplexity' })) as HTMLInputElement
    expect(input.placeholder).toBe('PERPLEXITY_API_KEY')
    const saves = screen.getAllByRole('button', { name: en.save })
    expect((saves[1] as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'pplx-live' } })
    fireEvent.click(saves[1]!)
    await screen.findByText(fill(en.savedKey, { provider: 'Perplexity' }))
    expect(input.value).toBe('')
    // Only a configured key offers removal.
    expect(screen.getAllByRole('button', { name: en.remove })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    await screen.findByText(fill(en.removedKey, { provider: 'Exa' }))
    expect(writes).toEqual([
      { kind: 'set', payload: { ref: 'PERPLEXITY_API_KEY', value: 'pplx-live' } },
      { kind: 'unset', payload: { ref: 'EXA_API_KEY' } },
    ])
  })

  it('surfaces a refused write beside the control', async () => {
    bench({ refuseWrites: true })
    await screen.findAllByText('Exa')
    fireEvent.change(screen.getByLabelText(en.selection), { target: { value: 'perplexity' } })
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('update refused')
    const input = screen.getByLabelText(fill(en.keyLabel, { provider: 'Exa' }))
    fireEvent.change(input, { target: { value: 'k' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('set refused') })
  })

  it('reads as read-only when the document refuses writes, and disables key forms the credential store refuses', async () => {
    bench({ writable: false, credentialWritable: false })
    await screen.findByText(en.readOnly)
    expect(screen.getByLabelText(en.selection)).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(fill(en.keyLabel, { provider: 'Exa' }))).toHaveProperty('disabled', true)
  })

  it.each([
    ['WEB_PROVIDER_CONFIGURED_MISSING', en.failureConfiguredMissing],
    ['WEB_PROVIDER_CONFIGURED_UNAVAILABLE', en.failureConfiguredUnavailable],
    ['WEB_PROVIDER_UNAVAILABLE', en.failureUnavailable],
    ['WEB_PROVIDER_AMBIGUOUS', en.failureAmbiguous],
  ])('says why no provider serves (%s)', async (failure, copy) => {
    bench({ selection: { failure } })
    await screen.findByText(copy)
  })

  it('names an effective provider the rows do not list by its id', async () => {
    bench({ selection: { effective: 'sidecar' } })
    await screen.findAllByText('Exa')
    expect(screen.getByRole('status').textContent).toBe(fill(en.selectionEffective, { provider: 'sidecar' }))
  })

  it('shows a load failure and a degraded key state', async () => {
    const { controller } = bench()
    await screen.findAllByText('Exa')
    controller.store.update((s) => { s.status = 'error'; s.error = 'web service is absent'; s.credentialError = 'no provider' })
    await screen.findByText(`${en.loadFailed}: web service is absent`)
    expect(screen.getByText(fill(en.credentialsUnavailable, { error: 'no provider' }))).toBeTruthy()
  })
})

describe('fill', () => {
  it('replaces known placeholders and leaves unknown ones', () => {
    expect(fill('{a} and {b}', { a: 'x' })).toBe('x and {b}')
  })
})
