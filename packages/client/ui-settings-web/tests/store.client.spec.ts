/** Page-store join: topology × namespaces × credentials, plus the two writes. */
import { describe, expect, it } from 'vitest'
import type { RpcResponse, WebSelectionView } from '@arx-ai/arx-api-remotes/client'
import { SettingsDescribeMirror } from '@arx-ai/arx-client-ui-settings/src/client/settings-mirror.ts'
import { apiKeyEnvOf, messageOf, WebSettingsStore } from '../src/client/store.ts'

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
  { provider: 'nested', displayName: 'Nested', settingsNs: 'web-search-many', settingsPath: ['providers', 'nested'], available: false },
  { provider: 'ghost', displayName: 'ghost', settingsNs: '', settingsPath: [], available: true },
]
const SELECTION: WebSelectionView = { configured: 'exa', effective: 'exa' }

const NAMESPACES = [
  { ns: 'web', schema: {}, value: { searchProvider: 'exa' }, applies: 'live' as const, secrets: [], revision: 7 },
  { ns: 'web-search-exa', schema: {}, value: { apiKeyEnv: 'EXA_API_KEY' }, applies: 'live' as const, secrets: [], revision: 0 },
  { ns: 'web-search-perplexity', schema: {}, value: { apiKeyEnv: '' }, applies: 'live' as const, secrets: [], revision: 0 },
  { ns: 'web-search-many', schema: {}, value: { providers: { nested: { apiKeyEnv: 'NESTED_KEY' } } }, applies: 'live' as const, secrets: [], revision: 0 },
]

interface Calls {
  refs: string[][]
  updates: unknown[]
  mutates: unknown[]
  sets: unknown[]
  unsets: unknown[]
}

function api(overrides: {
  providers?: () => Promise<RpcResponse<{ providers: typeof PROVIDERS; selection: WebSelectionView }>>
  describeSettings?: () => Promise<RpcResponse<{ writable: boolean; hasDocument: boolean; namespaces: typeof NAMESPACES }>>
  describeCredentials?: (refs: string[]) => Promise<RpcResponse<{ credentials: Record<string, unknown> }>>
  write?: () => Promise<RpcResponse<unknown>>
} = {}) {
  const calls: Calls = { refs: [], updates: [], mutates: [], sets: [], unsets: [] }
  const write = overrides.write ?? (() => Promise.resolve(ok({})))
  const face = {
    web: {
      providers: overrides.providers ?? (() => Promise.resolve(ok({ providers: PROVIDERS, selection: SELECTION }))),
    },
    settings: {
      describe: overrides.describeSettings ?? (() => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: NAMESPACES }))),
      update: (payload: unknown) => { calls.updates.push(payload); return write() },
      replace: () => Promise.resolve(fail('unused')),
      mutate: (payload: unknown) => { calls.mutates.push(payload); return write() },
    },
    credentials: {
      describe: (payload: { refs: string[] }) => {
        calls.refs.push(payload.refs)
        return (overrides.describeCredentials ?? (refs => Promise.resolve(ok({
          credentials: Object.fromEntries(refs.map(ref => [ref, { configured: ref === 'EXA_API_KEY', writable: true }])),
        }))))(payload.refs)
      },
      set: (payload: unknown) => { calls.sets.push(payload); return write() },
      unset: (payload: unknown) => { calls.unsets.push(payload); return write() },
    },
  }
  const wire = face as never
  return { face: wire, mirror: new SettingsDescribeMirror(wire), calls }
}

describe('WebSettingsStore', () => {
  it('joins rows with their credential reference and state, and reads the selection and revision', async () => {
    const { face, mirror, calls } = api()
    const store = new WebSettingsStore(face, mirror)
    await store.load()
    const state = store.store.getSnapshot()
    expect(state).toMatchObject({ status: 'ready', error: null, credentialError: null, writable: true, revision: 7, selection: SELECTION })
    expect(calls.refs).toEqual([['EXA_API_KEY', 'NESTED_KEY']])
    const byProvider = new Map(state.rows.map(row => [row.entry.provider, row]))
    expect(byProvider.get('exa')).toMatchObject({ apiKeyEnv: 'EXA_API_KEY', credential: { configured: true, writable: true } })
    expect(byProvider.get('nested')).toMatchObject({ apiKeyEnv: 'NESTED_KEY', credential: { configured: false } })
    expect(byProvider.get('perplexity')).toMatchObject({ apiKeyEnv: undefined, credential: undefined })
    expect(byProvider.get('ghost')).toMatchObject({ apiKeyEnv: undefined, credential: undefined })
  })

  it('degrades the key state, not the page, when the credential domain fails or rejects', async () => {
    const refusing = api({ describeCredentials: () => Promise.resolve(fail('no provider')) })
    const refused = new WebSettingsStore(refusing.face, refusing.mirror)
    await refused.load()
    expect(refused.store.getSnapshot()).toMatchObject({ status: 'ready', credentialError: 'no provider' })
    expect(refused.store.getSnapshot().rows.every(row => row.credential === undefined)).toBe(true)

    const rejecting = api({ describeCredentials: () => Promise.reject(new Error('transport down')) })
    const rejected = new WebSettingsStore(rejecting.face, rejecting.mirror)
    await rejected.load()
    expect(rejected.store.getSnapshot()).toMatchObject({ status: 'ready', credentialError: 'transport down' })
  })

  it('skips the credential describe when no row names a reference', async () => {
    const { face, mirror, calls } = api({
      providers: () => Promise.resolve(ok({ providers: [PROVIDERS[3]!], selection: { effective: 'ghost' } })),
    })
    const store = new WebSettingsStore(face, mirror)
    await store.load()
    expect(calls.refs).toEqual([])
    expect(store.store.getSnapshot().rows).toHaveLength(1)
  })

  it('surfaces a topology failure and keeps the last good rows', async () => {
    let refuse = false
    const { face, mirror } = api({
      providers: () => Promise.resolve(refuse ? fail('web service is absent') : ok({ providers: PROVIDERS, selection: SELECTION })),
    })
    const store = new WebSettingsStore(face, mirror)
    await store.load()
    refuse = true
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'web service is absent' })
    expect(store.store.getSnapshot().rows).toHaveLength(4)
  })

  it('reports the mirror as unavailable when it holds no settings answer', async () => {
    const { face, mirror } = api({ describeSettings: () => Promise.resolve(fail('settings offline')) })
    const store = new WebSettingsStore(face, mirror)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'settings offline' })
  })

  it('names the browser when the mirror holds neither an answer nor a failure', async () => {
    const { face } = api()
    const silent = { ensure: () => Promise.resolve(), getSnapshot: () => ({ status: 'unavailable', view: undefined, error: null }), subscribe: () => () => {} }
    const store = new WebSettingsStore(face, silent as never)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'error', error: 'settings are unavailable in this browser' })
  })

  it('leaves the key state unknown for a reference the credential domain did not describe', async () => {
    const { face, mirror } = api({ describeCredentials: () => Promise.resolve(ok({ credentials: {} })) })
    const store = new WebSettingsStore(face, mirror)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'ready', credentialError: null })
    expect(store.store.getSnapshot().rows.every(row => row.credential === undefined)).toBe(true)
  })

  it('lets the newest load win when an older one settles later', async () => {
    let release: (() => void) | undefined
    let slow = true
    const { face, mirror } = api({
      providers: () => slow
        ? new Promise((resolve) => { release = () => { resolve(ok({ providers: [PROVIDERS[0]!], selection: {} })) } })
        : Promise.resolve(ok({ providers: PROVIDERS, selection: SELECTION })),
    })
    const store = new WebSettingsStore(face, mirror)
    const first = store.load()
    slow = false
    await store.load()
    expect(store.store.getSnapshot().rows).toHaveLength(4)
    release!()
    await first
    expect(store.store.getSnapshot().rows).toHaveLength(4)
  })

  it('discards a stale load that fails after a newer one started', async () => {
    let reject: ((error: Error) => void) | undefined
    let slow = true
    const { face, mirror } = api({
      providers: () => slow
        ? new Promise((_resolve, rejectPromise) => { reject = rejectPromise })
        : Promise.resolve(ok({ providers: PROVIDERS, selection: SELECTION })),
    })
    const store = new WebSettingsStore(face, mirror)
    const first = store.load()
    slow = false
    await store.load()
    reject!(new Error('late failure'))
    await first
    expect(store.store.getSnapshot()).toMatchObject({ status: 'ready', error: null })
  })

  it('pins a provider with the fence it last read, and unpins through a path op', async () => {
    const { face, mirror, calls } = api()
    const store = new WebSettingsStore(face, mirror)
    await store.load()
    await expect(store.select('perplexity')).resolves.toBeNull()
    expect(calls.updates).toEqual([{ ns: 'web', patch: { searchProvider: 'perplexity' }, expectedRevision: 7 }])
    await expect(store.select(undefined)).resolves.toBeNull()
    expect(calls.mutates).toEqual([{ ns: 'web', ops: [{ op: 'unset', path: ['searchProvider'] }], expectedRevision: 7 }])
  })

  it('writes without a fence before the first load, and reports a refusal or a rejection', async () => {
    const refusing = api({ write: () => Promise.resolve(fail('settings-conflict')) })
    const store = new WebSettingsStore(refusing.face, refusing.mirror)
    await expect(store.select('exa')).resolves.toBe('settings-conflict')
    expect(refusing.calls.updates).toEqual([{ ns: 'web', patch: { searchProvider: 'exa' } }])

    const rejecting = api({ write: () => Promise.reject(new Error('transport down')) })
    await expect(new WebSettingsStore(rejecting.face, rejecting.mirror).select(undefined)).resolves.toBe('transport down')
  })

  it('stores a key through the credentials domain and removes it on an empty value', async () => {
    const { face, mirror, calls } = api()
    const store = new WebSettingsStore(face, mirror)
    await expect(store.writeKey('EXA_API_KEY', 'sk-live')).resolves.toBeNull()
    await expect(store.writeKey('EXA_API_KEY', '')).resolves.toBeNull()
    expect(calls.sets).toEqual([{ ref: 'EXA_API_KEY', value: 'sk-live' }])
    expect(calls.unsets).toEqual([{ ref: 'EXA_API_KEY' }])

    const refusing = api({ write: () => Promise.resolve(fail('credential-rejected')) })
    await expect(new WebSettingsStore(refusing.face, refusing.mirror).writeKey('EXA_API_KEY', 'x')).resolves.toBe('credential-rejected')
    const rejecting = api({ write: () => Promise.reject(new Error('offline')) })
    await expect(new WebSettingsStore(rejecting.face, rejecting.mirror).writeKey('EXA_API_KEY', 'x')).resolves.toBe('offline')
  })
})

describe('apiKeyEnvOf', () => {
  const view = (value: unknown) => ({ ns: 'n', schema: {}, value, applies: 'live' as const, secrets: [], revision: 0 }) as never

  it('walks the profile path and reads a non-empty string reference', () => {
    expect(apiKeyEnvOf(view({ apiKeyEnv: 'K' }), [])).toBe('K')
    expect(apiKeyEnvOf(view({ providers: { a: { apiKeyEnv: 'A' } } }), ['providers', 'a'])).toBe('A')
  })

  it('answers undefined for an absent section, path, profile, or reference', () => {
    expect(apiKeyEnvOf(undefined, [])).toBeUndefined()
    expect(apiKeyEnvOf(view({ providers: 'flat' }), ['providers', 'a'])).toBeUndefined()
    expect(apiKeyEnvOf(view({ providers: {} }), ['providers', 'a'])).toBeUndefined()
    expect(apiKeyEnvOf(view(null), [])).toBeUndefined()
    expect(apiKeyEnvOf(view({ apiKeyEnv: '' }), [])).toBeUndefined()
    expect(apiKeyEnvOf(view({ apiKeyEnv: 3 }), [])).toBeUndefined()
  })
})

describe('messageOf', () => {
  it('reads an Error message and stringifies anything else', () => {
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf('plain')).toBe('plain')
  })
})
