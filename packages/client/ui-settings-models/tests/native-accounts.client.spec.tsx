// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@arx-ai/arx-client-test-runtime'
import { createSnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { IApiClient, NativeAccountAttempt, NativeAccountView, RpcResponse, SettingsNamespaceView } from '@arx-ai/arx-api-remotes/client'
import type { SettingsDescribeFace } from '@arx-ai/arx-client-ui-settings/client'
import { NativeAccountsStore } from '../src/client/native-accounts-store.ts'
import { NativeAccounts } from '../src/client/NativeAccounts.tsx'
import { en } from '../src/client/locales.ts'

const account: NativeAccountView = {
  provider: 'claude-code', label: 'Claude Code', availability: 'available', status: 'connected', authMode: 'subscription',
  loginModes: ['browser'], loginInFlight: false,
  models: [
    { id: 'alias', resolvedModel: 'canonical-model', name: 'Model', efforts: ['high', 'turbo'] },
    { id: 'fast', name: 'Fast' },
  ],
}
/** Progress after the requested code is answered: the CLI asks for no further input. */
const answered: NativeAccountAttempt = {
  id: 'owned-login' as never, provider: 'claude-code', state: 'waiting', expiresAt: 999999,
  pollAfterMs: 25, url: 'https://example.com/sign-in',
}
const attempt: NativeAccountAttempt = { ...answered, input: 'code' }
const ok = <T,>(value: T): RpcResponse<T> => ({ rpcId: 'test' as never, result: { ok: true, value } })
const refused = (message: string): RpcResponse<never> =>
  ({ rpcId: 'test' as never, result: { ok: false, error: { code: 'internal', message, details: {} } } })
type Api = IApiClient['nativeAccounts']
type Reply<M extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<M>>

function bench(view: { writable?: boolean; namespace?: boolean } = {}) {
  let namespace: SettingsNamespaceView = {
    ns: 'llm-agent-cli', schema: {}, value: { providers: {} }, revision: 3, secrets: [], applies: 'live',
  }
  const nativeAccounts = {
    describe: vi.fn<Api['describe']>(async () => ok({ accounts: [account] })),
    begin: vi.fn<Api['begin']>(async () => ok({ attempt })),
    poll: vi.fn<Api['poll']>(async () => ok({ attempt: { ...attempt, state: 'connected' } })),
    submit: vi.fn<Api['submit']>(async () => ok({ attempt: answered })),
    cancel: vi.fn<Api['cancel']>(async () => ok({ attempt: { ...attempt, state: 'cancelled' } })),
  }
  const mutate = vi.fn<IApiClient['settings']['mutate']>(async () =>
    ok({ ...namespace, revision: 4, value: { providers: { 'claude-subscription': {} } } }))
  const settings = {
    ensure: async () => {},
    getSnapshot: () => ({ view: { writable: view.writable ?? true, namespaces: view.namespace === false ? [] : [namespace] } }),
    acceptView: (value: SettingsNamespaceView) => { namespace = value },
  } as unknown as SettingsDescribeFace
  const enabled = vi.fn()
  const controller = new NativeAccountsStore({ nativeAccounts, settings: { mutate } } as unknown as IApiClient, settings, enabled)
  const props = {
    available: true, useAccounts: bindSnapshotSelector(controller.store), watch: () => controller.watch(),
    reload: () => { void controller.load() }, begin: controller.begin.bind(controller),
    cancel: () => { void controller.cancel() }, submit: (code: string) => { void controller.submit(code) },
    enable: () => { void controller.enable() }, t: (key: string) => en[key as keyof typeof en],
  }
  return { controller, nativeAccounts, mutate, enabled, props, settings }
}
/** A reply the test delivers by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('native product accounts', () => {
  it('loads sanitized metadata and enables the canonical Claude models under the route preset name', async () => {
    const b = bench()
    await b.controller.load()
    expect(b.controller.store.getSnapshot().routeEnabled).toBe(false)
    await b.controller.enable()
    expect(b.mutate).toHaveBeenCalledWith({ ns: 'llm-agent-cli', expectedRevision: 3, ops: [{
      op: 'set', path: ['providers', 'claude-subscription'], value: {
        models: [{ id: 'canonical-model', name: 'Model', efforts: ['high'] }, { id: 'fast', name: 'Fast' }],
      },
    }] })
    expect(b.enabled).toHaveBeenCalledOnce()
    expect(b.controller.store.getSnapshot().routeEnabled).toBe(true)
    await b.controller.enable()
    expect(b.mutate).toHaveBeenCalledOnce()
    b.controller.dispose()
  })

  it.each([
    ['no loaded account', []],
    ['a signed-out account', [{ ...account, status: 'disconnected' as const }]],
    ['an API-key account', [{ ...account, authMode: 'api-key' as const }]],
    ['an account without models', [{ ...account, models: [] }]],
  ])('does not enable the route for %s', async (_case, accounts) => {
    const b = bench()
    b.nativeAccounts.describe.mockResolvedValue(ok({ accounts }))
    await b.controller.load()
    await b.controller.enable()
    expect(b.mutate).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot().busy).toBe(false)
  })

  it.each([
    ['read-only settings', { writable: false }],
    ['a missing route namespace', { namespace: false }],
  ])('reports %s instead of writing the route', async (_case, view) => {
    const b = bench(view)
    await b.controller.load()
    await b.controller.enable()
    expect(b.mutate).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot()).toMatchObject({ error: 'Native model settings are unavailable or read-only', busy: false })
  })

  it('reports a refused settings write and keeps the route disabled', async () => {
    const b = bench()
    b.mutate.mockResolvedValueOnce(refused('revision conflict'))
    await b.controller.load()
    await b.controller.enable()
    expect(b.controller.store.getSnapshot()).toMatchObject({ error: 'revision conflict', routeEnabled: false })
    expect(b.enabled).not.toHaveBeenCalled()
  })

  it('drops enable and load outcomes that arrive after disposal', async () => {
    const b = bench()
    await b.controller.load()
    const write = deferred<Reply<IApiClient['settings']['mutate']>>()
    b.mutate.mockReturnValueOnce(write.promise)
    const enabling = b.controller.enable()
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledOnce() })
    const status = deferred<Reply<Api['describe']>>()
    b.nativeAccounts.describe.mockReturnValueOnce(status.promise)
    const loading = b.controller.load()
    b.controller.dispose()
    write.resolve(refused('late failure'))
    status.resolve(refused('late status'))
    await Promise.all([enabling, loading])
    expect(b.enabled).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot()).toMatchObject({ error: null, busy: true, loading: true })
  })

  it('drops a successful write that lands after disposal', async () => {
    const b = bench()
    await b.controller.load()
    const write = deferred<Reply<IApiClient['settings']['mutate']>>()
    b.mutate.mockReturnValueOnce(write.promise)
    const enabling = b.controller.enable()
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledOnce() })
    b.controller.dispose()
    write.resolve(ok({ ns: 'llm-agent-cli', schema: {}, value: { providers: { 'claude-subscription': {} } }, revision: 4, secrets: [], applies: 'live' }))
    await enabling
    expect(b.enabled).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot().routeEnabled).toBe(false)
  })

  it('keeps only the newest status read', async () => {
    const b = bench()
    const first = deferred<Reply<Api['describe']>>()
    b.nativeAccounts.describe.mockReturnValueOnce(first.promise)
    const stale = b.controller.load()
    b.nativeAccounts.describe.mockResolvedValueOnce(refused('newest failure'))
    await b.controller.load()
    first.resolve(ok({ accounts: [{ ...account, label: 'Stale' }] }))
    await stale
    expect(b.controller.store.getSnapshot()).toMatchObject({ accounts: [], error: 'newest failure', loading: false })
    const older = deferred<Reply<Api['describe']>>()
    b.nativeAccounts.describe.mockReturnValueOnce(older.promise)
    const superseded = b.controller.load()
    await b.controller.load()
    older.resolve(refused('superseded failure'))
    await superseded
    expect(b.controller.store.getSnapshot()).toMatchObject({ error: null, loading: false })
    expect(b.controller.store.getSnapshot().accounts[0]?.label).toBe('Claude Code')
  })

  it('polls at the host cadence and cancels only its owned attempt on card disposal', async () => {
    vi.useFakeTimers()
    const b = bench()
    b.nativeAccounts.poll.mockResolvedValue(ok({ attempt }))
    const stop = b.controller.watch()
    await b.controller.begin('claude-code', 'browser')
    await vi.advanceTimersByTimeAsync(25)
    expect(b.nativeAccounts.poll).toHaveBeenCalledWith({ attemptId: attempt.id })
    stop()
    await vi.advanceTimersByTimeAsync(100)
    expect(b.nativeAccounts.cancel).toHaveBeenCalledWith({ attemptId: attempt.id })
    expect(b.nativeAccounts.poll).toHaveBeenCalledOnce()
    b.controller.dispose()
  })

  it('revokes a login that starts after the card has closed', async () => {
    const b = bench()
    let finish!: (response: RpcResponse<{ attempt: NativeAccountAttempt }>) => void
    b.nativeAccounts.begin.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const starting = b.controller.begin('claude-code', 'browser')
    b.controller.dispose()
    finish(ok({ attempt }))
    await starting
    expect(b.nativeAccounts.cancel).toHaveBeenCalledWith({ attemptId: attempt.id })
    expect(b.controller.store.getSnapshot().attempt).toBeNull()
  })

  it('leaves a superseded login that already settled alone and reports only the current start', async () => {
    const b = bench()
    let finish!: (response: RpcResponse<{ attempt: NativeAccountAttempt }>) => void
    b.nativeAccounts.begin.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const superseded = b.controller.begin('claude-code', 'browser')
    b.nativeAccounts.begin.mockResolvedValueOnce(refused('A sign-in is already running for this product.'))
    await b.controller.begin('codex', 'device-code')
    finish(ok({ attempt: { ...attempt, state: 'failed' } }))
    await superseded
    expect(b.nativeAccounts.cancel).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot()).toMatchObject({ error: 'A sign-in is already running for this product.', busy: false })
    let fail!: (reason: Error) => void
    b.nativeAccounts.begin.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const late = b.controller.begin('claude-code', 'browser')
    await b.controller.cancel()
    fail(new Error('late start failure'))
    await late
    expect(b.controller.store.getSnapshot()).toMatchObject({ error: null, busy: false })
  })

  it('refreshes accounts once a login settles and reports poll failures only for the current attempt', async () => {
    vi.useFakeTimers()
    const b = bench()
    b.nativeAccounts.begin.mockResolvedValueOnce(ok({ attempt: { ...attempt, state: 'connected' } }))
    await b.controller.begin('claude-code', 'browser')
    expect(b.nativeAccounts.describe).toHaveBeenCalledOnce()
    b.nativeAccounts.poll.mockResolvedValueOnce(refused('attempt expired'))
    await b.controller.begin('claude-code', 'browser')
    await vi.advanceTimersByTimeAsync(25)
    expect(b.controller.store.getSnapshot().error).toBe('attempt expired')
    let fail!: (reason: Error) => void
    b.nativeAccounts.poll.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    await b.controller.begin('claude-code', 'browser')
    await vi.advanceTimersByTimeAsync(25)
    await b.controller.cancel()
    fail(new Error('superseded poll'))
    await vi.advanceTimersByTimeAsync(0)
    expect(b.controller.store.getSnapshot()).toMatchObject({ error: null, attempt: { state: 'cancelled' } })
    b.controller.dispose()
  })

  it('ignores a poll answer that arrives after its attempt was cancelled', async () => {
    vi.useFakeTimers()
    const b = bench()
    const late = deferred<Reply<Api['poll']>>()
    b.nativeAccounts.poll.mockReturnValueOnce(late.promise)
    await b.controller.begin('claude-code', 'browser')
    await vi.advanceTimersByTimeAsync(25)
    await b.controller.cancel()
    late.resolve(ok({ attempt: { ...attempt, state: 'connected' } }))
    await vi.advanceTimersByTimeAsync(0)
    expect(b.controller.store.getSnapshot().attempt?.state).toBe('cancelled')
    b.controller.dispose()
  })

  it('submits only a requested code and keeps only current submit outcomes', async () => {
    vi.useFakeTimers()
    const b = bench()
    await b.controller.submit('unrequested')
    expect(b.nativeAccounts.submit).not.toHaveBeenCalled()
    b.nativeAccounts.begin.mockResolvedValueOnce(ok({ attempt: answered }))
    await b.controller.begin('claude-code', 'browser')
    await b.controller.submit('not-requested-yet')
    expect(b.nativeAccounts.submit).not.toHaveBeenCalled()
    await b.controller.begin('claude-code', 'browser')
    b.nativeAccounts.submit.mockResolvedValueOnce(refused('Enter one authorization code.'))
    await b.controller.submit('bad\ncode')
    expect(b.controller.store.getSnapshot()).toMatchObject({ error: 'Enter one authorization code.', busy: false })
    await b.controller.begin('claude-code', 'browser')
    const late = deferred<Reply<Api['submit']>>()
    b.nativeAccounts.submit.mockReturnValueOnce(late.promise)
    const submitting = b.controller.submit('slow-code')
    await b.controller.cancel()
    late.resolve(refused('late submit failure'))
    await submitting
    expect(b.controller.store.getSnapshot().error).toBeNull()
    await b.controller.begin('claude-code', 'browser')
    const replaced = deferred<Reply<Api['submit']>>()
    b.nativeAccounts.submit.mockReturnValueOnce(replaced.promise)
    const replacing = b.controller.submit('slow-code')
    await b.controller.cancel()
    replaced.resolve(ok({ attempt: { ...answered, state: 'connected' } }))
    await replacing
    expect(b.controller.store.getSnapshot().attempt?.state).toBe('cancelled')
    b.controller.dispose()
  })

  it('reports a refused cancellation and ignores cancellations that lose to disposal or a new start', async () => {
    vi.useFakeTimers()
    const b = bench()
    await b.controller.cancel()
    expect(b.nativeAccounts.cancel).not.toHaveBeenCalled()
    await b.controller.begin('claude-code', 'browser')
    b.nativeAccounts.cancel.mockResolvedValueOnce(refused('cancel refused'))
    await b.controller.cancel()
    expect(b.controller.store.getSnapshot().error).toBe('cancel refused')
    await b.controller.begin('claude-code', 'browser')
    const superseded = deferred<Reply<Api['cancel']>>()
    b.nativeAccounts.cancel.mockReturnValueOnce(superseded.promise)
    const cancelling = b.controller.cancel()
    await b.controller.begin('claude-code', 'browser')
    superseded.resolve(ok({ attempt: { ...attempt, state: 'cancelled' } }))
    await cancelling
    expect(b.controller.store.getSnapshot().attempt?.state).toBe('waiting')
    const disposed = deferred<Reply<Api['cancel']>>()
    b.nativeAccounts.cancel.mockReturnValueOnce(disposed.promise)
    b.controller.dispose()
    disposed.resolve(refused('late cancel failure'))
    await vi.advanceTimersByTimeAsync(0)
    expect(b.nativeAccounts.cancel).toHaveBeenCalledTimes(3)
    expect(b.controller.store.getSnapshot().error).toBeNull()
  })

  it('shows a real login link, accepts a CLI-requested code, clears it, and refreshes on completion', async () => {
    const b = bench()
    b.nativeAccounts.poll.mockImplementation(async () => ok({ attempt: b.nativeAccounts.submit.mock.calls.length > 0
      ? { ...attempt, state: 'connected' } : attempt }))
    const view = render(<NativeAccounts {...b.props} />)
    await screen.findByText('Claude Code')
    fireEvent.click(screen.getByRole('button', { name: 'Connect in browser' }))
    const link = await screen.findByRole('link', { name: 'Open sign-in page' })
    expect(link.getAttribute('href')).toBe('https://example.com/sign-in')
    const input = screen.getByLabelText('Authorization code') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'one-time-code' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit code' }))
    await waitFor(() => { expect(b.nativeAccounts.submit).toHaveBeenCalledWith({ attemptId: attempt.id, code: 'one-time-code' }) })
    expect(input.value).toBe('')
    await screen.findByText('Account connected.')
    expect(b.nativeAccounts.describe.mock.calls.length).toBeGreaterThan(1)
    view.unmount()
    b.controller.dispose()
  })

  it('shows status failures and does not read accounts for a remote browser', async () => {
    const b = bench()
    b.nativeAccounts.describe.mockRejectedValueOnce(new Error('status unavailable'))
    await b.controller.load()
    const view = render(<NativeAccounts {...b.props} watch={() => () => {}} />)
    expect(screen.getByRole('alert').textContent).toBe('status unavailable')
    view.unmount()
    b.nativeAccounts.describe.mockClear()
    render(<NativeAccounts {...b.props} available={false} />)
    await act(async () => {})
    expect(b.nativeAccounts.describe).not.toHaveBeenCalled()
    expect(screen.queryByText('Native product accounts')).toBeNull()
    b.controller.dispose()
  })
})

describe('native product account card', () => {
  type State = ReturnType<NativeAccountsStore['store']['getSnapshot']>
  function card(state: Partial<State>) {
    const store = createSnapshotStore<State>({
      accounts: [], attempt: null, routeEnabled: false, loading: false, busy: false, error: null, ...state,
    })
    const props = { available: true, useAccounts: bindSnapshotSelector(store), watch: () => () => {}, reload: vi.fn(),
      begin: vi.fn(), cancel: vi.fn(), submit: vi.fn(), enable: vi.fn(), t: (key: string) => en[key as keyof typeof en] }
    render(<NativeAccounts {...props} />)
    return props
  }

  it('describes every account status and authentication kind', () => {
    const props = card({ loading: true, accounts: [
      { provider: 'claude-code', label: 'Unavailable tool', availability: 'unavailable', status: 'unknown', loginModes: ['browser'], loginInFlight: false },
      { provider: 'codex', label: 'Unknown status', availability: 'available', status: 'unknown', loginModes: ['device-code'], loginInFlight: false },
    ] })
    expect(screen.getByRole('status').textContent).toBe('Checking accounts…')
    expect(screen.getByText('Native tool unavailable')).toBeTruthy()
    expect(screen.getByText('Status unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect in browser' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Connect with device code' }))
    expect(props.begin).toHaveBeenCalledWith('codex', 'device-code')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh account status' }).disabled).toBe(true)
    cleanup()
    card({ accounts: [
      { provider: 'claude-code', label: 'Signed out', availability: 'available', status: 'disconnected', loginModes: ['browser'], loginInFlight: false },
      { provider: 'codex', label: 'Key account', availability: 'available', status: 'connected', authMode: 'api-key', loginModes: [], loginInFlight: false },
    ] })
    expect(screen.getByText('Not connected')).toBeTruthy()
    expect(screen.getByText('API key authentication')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enable in chat' })).toBeNull()
  })

  it('asks for a subscription before Claude models can serve chat and enables them on request', () => {
    const props = card({ accounts: [{ ...account, authMode: 'api-key' }] })
    expect(screen.getByText('Connect a confirmed subscription account to enable Claude chat models.')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Enable in chat' }).disabled).toBe(true)
    cleanup()
    const ready = card({ accounts: [account] })
    expect(screen.getByText('Model, Fast')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Enable in chat' }))
    expect(ready.enable).toHaveBeenCalledOnce()
    expect(props.enable).not.toHaveBeenCalled()
    cleanup()
    card({ accounts: [account], routeEnabled: true })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Enabled in chat' }).disabled).toBe(true)
  })

  it('shows a device code and the product message while a sign-in runs', () => {
    const props = card({ accounts: [{ ...account, provider: 'codex', label: 'OpenAI Codex', loginModes: ['device-code'] }],
      attempt: { ...answered, provider: 'codex', code: 'ABCD-EFGH', message: 'Waiting for approval' } })
    expect(screen.getByText('ABCD-EFGH')).toBeTruthy()
    expect(screen.getByText('Waiting for approval')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.cancel).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh account status' }))
    expect(props.reload).toHaveBeenCalledOnce()
  })
})
