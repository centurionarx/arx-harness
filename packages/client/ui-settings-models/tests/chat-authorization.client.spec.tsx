// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@arx-ai/arx-client-test-runtime'
import type {
  AuthorizationAttemptView, AuthorizationFlowView, IApiClient, RpcResponse, SettingsNamespaceView,
} from '@arx-ai/arx-api-remotes/client'
import type { SettingsDescribeFace } from '@arx-ai/arx-client-ui-settings/client'
import { ChatAuthorizationStore } from '../src/client/chat-authorization-store.ts'
import { ChatAuthorization } from '../src/client/ChatAuthorization.tsx'
import { en } from '../src/client/locales.ts'

const attempt: AuthorizationAttemptView = {
  id: 'owned-auth' as never, key: 'llm-pi-ai/openai-codex' as never, state: 'waiting', expiresAt: 999999, pollAfterMs: 25,
  notice: { message: 'Sign in to OpenAI', url: 'https://example.com/oauth' },
  prompt: { id: 'prompt-1' as never, kind: 'secret', message: 'Paste the callback code' },
}
const ok = <T,>(value: T): RpcResponse<T> => ({ rpcId: 'test' as never, result: { ok: true, value } })
function bench() {
  let configured = false
  let namespace: SettingsNamespaceView = { ns: 'llm-pi-ai', schema: {}, value: { providers: {} }, revision: 2, secrets: [], applies: 'live' }
  const flow = (): AuthorizationFlowView => ({
    key: attempt.key, label: 'OpenAI Codex', methods: [{ id: 'oauth', label: 'OAuth' }], inFlight: false,
    configured, writable: true, ...configured ? { kind: 'grant' as const } : {},
  })
  const authorization = {
    describe: vi.fn(async () => ok({ flows: [flow()] })),
    begin: vi.fn(async () => ok({ attempt })),
    poll: vi.fn(async () => ok({ attempt })),
    submit: vi.fn(async () => { configured = true; return ok({ attempt: { ...attempt, state: 'authorized' as const } }) }),
    cancel: vi.fn(async () => ok({ attempt: { ...attempt, state: 'cancelled' as const } })),
  }
  const mutate = vi.fn(async () => ok({ ...namespace, revision: 3, value: { providers: { 'openai-codex': {} } } }))
  const mirror = {
    ensure: async () => {}, getSnapshot: () => ({ view: { writable: true, namespaces: [namespace] } }),
    acceptView: (view: SettingsNamespaceView) => { namespace = view },
  } as unknown as SettingsDescribeFace
  const onEnabled = vi.fn()
  const controller = new ChatAuthorizationStore({ authorization, settings: { mutate } } as unknown as IApiClient, mirror, onEnabled)
  const props = {
    available: true, useAuthorization: bindSnapshotSelector(controller.store), watch: () => controller.watch(),
    begin: () => { controller.begin() }, cancel: () => { void controller.cancel() },
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
    fireEvent.click(screen.getByRole('button', { name: 'Submit code' }))
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
    b.authorization.poll.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
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
    b.authorization.begin.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
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
})
