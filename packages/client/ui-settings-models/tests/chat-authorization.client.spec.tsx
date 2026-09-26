// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@arx-ai/arx-client-test-runtime'
import type {
  AuthorizationAttemptView, AuthorizationFlowView, IApiClient, RpcResponse, SettingsNamespaceView,
} from '@arx-ai/arx-api-remotes/client'
import type { HostDescriptionSource } from '@arx-ai/arx-client-connection/client'
import type { SettingsDescribeFace } from '@arx-ai/arx-client-ui-settings/client'
import { createSnapshotStore } from '@arx-ai/arx-client-runtime/client'
import { ChatAuthorizationStore } from '../src/client/chat-authorization-store.ts'
import { ChatAuthorization } from '../src/client/ChatAuthorization.tsx'
import { en } from '../src/client/locales.ts'

const attempt: AuthorizationAttemptView = {
  id: 'owned-auth' as never, key: 'llm-pi-ai/openai-codex' as never, state: 'waiting', expiresAt: 999999, pollAfterMs: 25,
  notice: { message: 'Sign in to OpenAI', url: 'https://example.com/oauth' },
  prompt: { id: 'prompt-1' as never, kind: 'secret', message: 'Paste the callback code' },
}
const ok = <T,>(value: T): RpcResponse<T> => ({ rpcId: 'test' as never, result: { ok: true, value } })
const refused = (message: string): RpcResponse<never> =>
  ({ rpcId: 'test' as never, result: { ok: false, error: { code: 'internal', message, details: {} } } })
type Api = IApiClient['authorization']
type Reply<M extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<M>>
/** A reply the test delivers by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}
/** The host description the card reads; `undefined` is a connection that is not up yet. */
function host(canOpenPath?: boolean): HostDescriptionSource {
  const description = canOpenPath === undefined ? undefined
    : { version: 'test', cwd: '/workspace', attachedSessions: 1, home: '/h', canOpenPath }
  return { getSnapshot: () => description, subscribe: () => () => {} }
}
function bench(view: { writable?: boolean; namespace?: boolean } = {}) {
  let configured = false
  let namespace: SettingsNamespaceView = { ns: 'llm-pi-ai', schema: {}, value: { providers: {} }, revision: 2, secrets: [], applies: 'live' }
  const flow = (): AuthorizationFlowView => ({
    key: attempt.key, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'OAuth' }], inFlight: false,
    configured, writable: true, ...configured ? { kind: 'grant' as const } : {},
  })
  const authorization = {
    describe: vi.fn<Api['describe']>(async () => ok({ flows: [flow()] })),
    begin: vi.fn<Api['begin']>(async () => ok({ attempt })),
    poll: vi.fn<Api['poll']>(async () => ok({ attempt })),
    submit: vi.fn<Api['submit']>(async () => { configured = true; return ok({ attempt: { ...attempt, state: 'authorized' } }) }),
    cancel: vi.fn<Api['cancel']>(async () => ok({ attempt: { ...attempt, state: 'cancelled' } })),
  }
  const mutate = vi.fn<IApiClient['settings']['mutate']>(async () => ok({ ...namespace, revision: 3, value: { providers: { 'openai-codex': {} } } }))
  const mirror = {
    ensure: async () => {},
    getSnapshot: () => ({ view: { writable: view.writable ?? true, namespaces: view.namespace === false ? [] : [namespace] } }),
    acceptView: (next: SettingsNamespaceView) => { namespace = next },
  } as unknown as SettingsDescribeFace
  const onEnabled = vi.fn()
  const controller = new ChatAuthorizationStore({ authorization, settings: { mutate } } as unknown as IApiClient, mirror, onEnabled)
  const props = {
    available: true, useAuthorization: bindSnapshotSelector(controller.store), useHostDescription: bindSnapshotSelector(host()),
    watch: () => controller.watch(), begin: () => { controller.begin() }, cancel: () => { void controller.cancel() },
    submit: (answer: string) => { controller.submit(answer) }, enable: () => { void controller.enable() },
    reload: () => { void controller.load() }, t: (key: string) => en[key as keyof typeof en],
  }
  return { controller, authorization, mutate, props, onEnabled, setConfigured: () => { configured = true } }
}

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('OpenAI Codex chat authorization', () => {
  it('submits the owned prompt, clears its secret, then enables the OAuth-backed provider without replacing a catalog', async () => {
    const b = bench()
    const view = render(<ChatAuthorization {...b.props} />)
    const connect = await screen.findByRole('button', { name: 'Connect OpenAI for chat' })
    fireEvent.click(connect)
    const input = await screen.findByLabelText('Paste the callback code') as HTMLInputElement
    expect(screen.getByRole('link', { name: 'Open sign-in page' }).getAttribute('href')).toBe('https://example.com/oauth')
    fireEvent.change(input, { target: { value: 'private-one-time-code' } })
    // The prompt may ask for a code or an address, so its submit button names neither.
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await screen.findByText('Enabled in chat')
    expect(b.authorization.submit).toHaveBeenCalledWith({ attemptId: attempt.id, promptId: 'prompt-1', answer: 'private-one-time-code' })
    expect(input.value).toBe('')
    expect(JSON.stringify(b.controller.store.getSnapshot())).not.toContain('private-one-time-code')
    expect(b.mutate).toHaveBeenCalledWith({ ns: 'llm-pi-ai', expectedRevision: 2,
      ops: [{ op: 'set', path: ['providers', 'openai-codex'], value: {} }],
    })
    await b.controller.enable()
    expect(b.mutate).toHaveBeenCalledOnce()
    view.unmount()
    b.controller.dispose()
  })

  it('ignores a superseded poll without cancelling the same login after a prompt submission', async () => {
    vi.useFakeTimers()
    const b = bench()
    let finish!: (value: RpcResponse<{ attempt: AuthorizationAttemptView }>) => void
    b.authorization.poll.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await b.controller.load()
    b.controller.begin()
    await vi.advanceTimersByTimeAsync(25)
    b.controller.submit('code')
    await vi.advanceTimersByTimeAsync(0)
    finish(ok({ attempt }))
    await vi.advanceTimersByTimeAsync(0)
    expect(b.controller.store.getSnapshot().attempt?.state).toBe('authorized')
    expect(b.authorization.cancel).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('cancels only its own late start on unmount and stops all polling', async () => {
    vi.useFakeTimers()
    const b = bench()
    let finish!: (value: RpcResponse<{ attempt: AuthorizationAttemptView }>) => void
    b.authorization.begin.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await b.controller.load()
    b.controller.begin()
    b.controller.dispose()
    finish(ok({ attempt }))
    await vi.advanceTimersByTimeAsync(100)
    expect(b.authorization.cancel).toHaveBeenCalledWith({ attemptId: attempt.id })
    expect(b.authorization.poll).not.toHaveBeenCalled()
  })

  it('does not activate a provider without a stored grant and does not request login data remotely', async () => {
    const b = bench()
    await b.controller.enable()
    expect(b.mutate).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot().error).toContain('Connect your OpenAI subscription')
    b.authorization.describe.mockClear()
    render(<ChatAuthorization {...b.props} available={false} />)
    await act(async () => {})
    expect(b.authorization.describe).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('surfaces carrier failures without retaining submitted answers', async () => {
    const b = bench()
    b.authorization.begin.mockRejectedValueOnce(new Error('offline'))
    await b.controller.load()
    b.controller.begin()
    await waitFor(() => { expect(b.controller.store.getSnapshot().error).toBe('offline') })
    expect(b.controller.store.getSnapshot().busy).toBe(false)
    b.controller.dispose()
  })

  it('reports a refused flow directory and an absent flow', async () => {
    const b = bench()
    b.authorization.describe.mockResolvedValueOnce(refused('Authorization status is unavailable.'))
    expect(await b.controller.load()).toBe(false)
    expect(b.controller.store.getSnapshot().error).toBe('Authorization status is unavailable.')
    b.authorization.describe.mockResolvedValueOnce(ok({ flows: [] }))
    expect(await b.controller.load()).toBe(true)
    expect(b.controller.store.getSnapshot().flow).toBeNull()
    b.controller.begin()
    expect(b.authorization.begin).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it.each([
    ['a read-only flow', { writable: false }],
    ['a flow without a subscription method', { methods: [{ id: 'api-key', label: 'API key' }] }],
  ])('does not start %s', async (_case, change) => {
    const b = bench()
    b.authorization.describe.mockResolvedValueOnce(ok({ flows: [{
      key: attempt.key, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'OAuth' }], inFlight: false, configured: false, writable: true, ...change,
    }] }))
    await b.controller.load()
    b.controller.begin()
    expect(b.authorization.begin).not.toHaveBeenCalled()
  })

  it('ignores a directory that arrives after disposal', async () => {
    const b = bench()
    const late = deferred<Reply<Api['describe']>>()
    b.authorization.describe.mockReturnValueOnce(late.promise)
    const loading = b.controller.load()
    b.controller.dispose()
    late.resolve(ok({ flows: [] }))
    expect(await loading).toBe(false)
    expect(b.controller.store.getSnapshot().flow).toBeNull()
  })

  it('answers only a current prompt', () => {
    const b = bench()
    b.controller.submit('no attempt')
    b.controller.store.update((state) => { state.attempt = { ...attempt, prompt: undefined } as never })
    b.controller.submit('no prompt')
    expect(b.authorization.submit).not.toHaveBeenCalled()
  })

  it.each([
    ['read-only chat settings', { writable: false }],
    ['a missing chat namespace', { namespace: false }],
  ])('refuses to enable the route with %s', async (_case, view) => {
    const b = bench(view)
    b.setConfigured()
    await b.controller.enable()
    expect(b.mutate).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot().error).toBe('Chat model settings are unavailable or read-only')
  })

  it('reports a refused route write and a failed directory before enabling', async () => {
    const b = bench()
    b.setConfigured()
    b.mutate.mockResolvedValueOnce(refused('revision conflict'))
    await b.controller.enable()
    expect(b.controller.store.getSnapshot()).toMatchObject({ error: 'revision conflict', enabled: false })
    b.authorization.describe.mockResolvedValueOnce(refused('directory offline'))
    await b.controller.enable()
    expect(b.mutate).toHaveBeenCalledOnce()
    expect(b.controller.store.getSnapshot().error).toBe('directory offline')
  })

  it('drops a route write that lands after disposal', async () => {
    const b = bench()
    b.setConfigured()
    const write = deferred<Reply<IApiClient['settings']['mutate']>>()
    b.mutate.mockReturnValueOnce(write.promise)
    const enabling = b.controller.enable()
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledOnce() })
    b.controller.dispose()
    write.resolve(ok({ ns: 'llm-pi-ai', schema: {}, value: { providers: { 'openai-codex': {} } }, revision: 3, secrets: [], applies: 'live' }))
    await enabling
    expect(b.onEnabled).not.toHaveBeenCalled()
    expect(b.controller.store.getSnapshot().enabled).toBe(false)
  })

  it('leaves settled attempts alone on cancellation and reports a refused cancellation', async () => {
    vi.useFakeTimers()
    const b = bench()
    await b.controller.cancel()
    b.authorization.begin.mockResolvedValueOnce(ok({ attempt: { ...attempt, state: 'failed', message: 'Authorization failed. Please retry.' } }))
    await b.controller.load()
    b.controller.begin()
    await vi.advanceTimersByTimeAsync(0)
    await b.controller.cancel()
    expect(b.authorization.cancel).not.toHaveBeenCalled()
    expect(b.onEnabled).not.toHaveBeenCalled()
    b.controller.begin()
    await vi.advanceTimersByTimeAsync(0)
    b.authorization.cancel.mockResolvedValueOnce(refused('cancel refused'))
    await b.controller.cancel()
    expect(b.controller.store.getSnapshot().error).toBe('cancel refused')
    b.controller.dispose()
  })

  it('cancels its current attempt and shows the cancelled progress', async () => {
    vi.useFakeTimers()
    const b = bench()
    await b.controller.load()
    b.controller.begin()
    await vi.advanceTimersByTimeAsync(0)
    await b.controller.cancel()
    expect(b.authorization.cancel).toHaveBeenCalledWith({ attemptId: attempt.id })
    expect(b.controller.store.getSnapshot()).toMatchObject({ attempt: { state: 'cancelled' }, busy: false })
    await vi.advanceTimersByTimeAsync(100)
    expect(b.authorization.poll).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('keeps only current cancellation and poll outcomes', async () => {
    vi.useFakeTimers()
    const b = bench()
    await b.controller.load()
    b.controller.begin()
    await vi.advanceTimersByTimeAsync(0)
    const superseded = deferred<Reply<Api['cancel']>>()
    b.authorization.cancel.mockReturnValueOnce(superseded.promise)
    const cancelling = b.controller.cancel()
    b.controller.begin()
    await vi.advanceTimersByTimeAsync(0)
    superseded.resolve(ok({ attempt: { ...attempt, state: 'cancelled' } }))
    await cancelling
    expect(b.controller.store.getSnapshot().attempt?.state).toBe('waiting')
    b.authorization.poll.mockResolvedValueOnce(refused('attempt expired'))
    await vi.advanceTimersByTimeAsync(25)
    expect(b.controller.store.getSnapshot()).toMatchObject({ error: 'attempt expired', busy: false })
    b.controller.begin()
    await vi.advanceTimersByTimeAsync(0)
    let fail!: (reason: Error) => void
    b.authorization.poll.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    await vi.advanceTimersByTimeAsync(25)
    b.controller.begin()
    fail(new Error('superseded poll'))
    await vi.advanceTimersByTimeAsync(0)
    expect(b.controller.store.getSnapshot().error).toBeNull()
    const disposed = deferred<Reply<Api['cancel']>>()
    b.authorization.cancel.mockReturnValueOnce(disposed.promise)
    b.controller.dispose()
    disposed.resolve(refused('late cancel failure'))
    await vi.advanceTimersByTimeAsync(0)
    expect(b.controller.store.getSnapshot().error).toBeNull()
  })

  it('does not revoke a late start that already settled', async () => {
    const b = bench()
    const late = deferred<Reply<Api['begin']>>()
    b.authorization.begin.mockReturnValueOnce(late.promise)
    await b.controller.load()
    b.controller.begin()
    b.controller.dispose()
    late.resolve(ok({ attempt: { ...attempt, state: 'cancelled' } }))
    await vi.waitFor(() => { expect(b.controller.store.getSnapshot().busy).toBe(true) })
    expect(b.authorization.cancel).not.toHaveBeenCalled()
  })
})

describe('chat authorization card', () => {
  type State = ReturnType<ChatAuthorizationStore['store']['getSnapshot']>
  const flow: AuthorizationFlowView = {
    key: attempt.key, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'OAuth' }], inFlight: false, configured: false, writable: true,
  }
  function card(state: Partial<State>, canOpenPath?: boolean) {
    const store = createSnapshotStore<State>({ flow: null, attempt: null, enabled: false, busy: false, error: null, ...state })
    const props = {
      available: true, useAuthorization: bindSnapshotSelector(store), useHostDescription: bindSnapshotSelector(host(canOpenPath)),
      watch: () => () => {}, begin: vi.fn(), cancel: vi.fn(), submit: vi.fn(), enable: vi.fn(), reload: vi.fn(),
      t: (key: string) => en[key as keyof typeof en],
    }
    render(<ChatAuthorization {...props} />)
    return props
  }

  it('explains remote sign-in only on a host without a desktop that offers the flow', () => {
    card({ flow }, false)
    expect(screen.getByText(en['chatAuth.remoteSignIn'])).toBeTruthy()
    cleanup()
    card({ flow: null }, false)
    expect(screen.queryByText(en['chatAuth.remoteSignIn'])).toBeNull()
    cleanup()
    card({ flow }, true)
    expect(screen.queryByText(en['chatAuth.remoteSignIn'])).toBeNull()
    cleanup()
    card({ flow })
    expect(screen.queryByText(en['chatAuth.remoteSignIn'])).toBeNull()
  })

  it('shows the carrier error, the product message, and the flow status', () => {
    card({ flow, error: 'directory offline', attempt: { ...attempt, state: 'failed', notice: undefined, prompt: undefined, message: 'Authorization failed. Please retry.' } as never })
    expect(screen.getByRole('alert').textContent).toBe('directory offline')
    expect(screen.getByText('Authorization failed. Please retry.')).toBeTruthy()
    expect(screen.getByText('Sign-in failed. Try again.')).toBeTruthy()
    expect(screen.getByText('Not connected')).toBeTruthy()
  })

  it('offers select prompts as buttons and a notice without an address or code', () => {
    const props = card({ flow: { ...flow, configured: true, kind: 'grant' }, attempt: {
      ...attempt, notice: { message: 'Choose where to sign in' },
      prompt: { id: 'prompt-2' as never, kind: 'select', message: 'Account', options: [{ id: 'personal', label: 'Personal' }, { id: 'work', label: 'Work' }] },
    } })
    expect(screen.getByText('Choose where to sign in')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open sign-in page' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Work' }))
    expect(props.submit).toHaveBeenCalledWith('work')
    fireEvent.click(screen.getByRole('button', { name: 'Enable in chat' }))
    expect(props.enable).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh account status' }))
    expect(props.reload).toHaveBeenCalledOnce()
  })

  it('shows a device code from the notice', () => {
    card({ flow, attempt: { ...attempt, notice: { message: 'Enter the code', code: 'WXYZ-1234' }, prompt: undefined } as never })
    expect(screen.getByText('WXYZ-1234')).toBeTruthy()
    expect(screen.getByText('Complete sign-in in your browser.')).toBeTruthy()
  })

  it('reads as starting while the flow asks a question before its browser step', () => {
    card({ flow, attempt: { ...attempt, notice: undefined, prompt: {
      id: 'prompt-3' as never, kind: 'select', message: 'Select a login method', options: [{ id: 'browser', label: 'Browser login' }],
    } } as never })
    expect(screen.getByText('Starting sign-in…')).toBeTruthy()
    expect(screen.queryByText('Complete sign-in in your browser.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Browser login' })).toBeTruthy()
  })
})
