// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@arx-ai/arx-client-test-runtime'
import type { IApiClient, NativeAccountAttempt, NativeAccountView, RpcResponse, SettingsNamespaceView } from '@arx-ai/arx-api-remotes/client'
import type { SettingsDescribeFace } from '@arx-ai/arx-client-ui-settings/client'
import { NativeAccountsStore } from '../src/client/native-accounts-store.ts'
import { NativeAccounts } from '../src/client/NativeAccounts.tsx'
import { en } from '../src/client/locales.ts'

const account: NativeAccountView = {
  provider: 'claude-code', label: 'Claude Code', availability: 'available', status: 'connected', authMode: 'subscription',
  loginModes: ['browser'], loginInFlight: false,
  models: [{ id: 'alias', resolvedModel: 'canonical-model', name: 'Model', efforts: ['high'] }],
}
const attempt: NativeAccountAttempt = {
  id: 'owned-login' as never, provider: 'claude-code', state: 'waiting', expiresAt: 999999,
  pollAfterMs: 25, url: 'https://example.com/sign-in', input: 'code',
}
const ok = <T,>(value: T): RpcResponse<T> => ({ rpcId: 'test' as never, result: { ok: true, value } })

function bench() {
  let namespace: SettingsNamespaceView = {
    ns: 'llm-agent-cli', schema: {}, value: { providers: {} }, revision: 3, secrets: [], applies: 'live',
  }
  const nativeAccounts = {
    describe: vi.fn(async () => ok({ accounts: [account] })),
    begin: vi.fn(async () => ok({ attempt })),
    poll: vi.fn(async () => ok({ attempt: { ...attempt, state: 'connected' as const } })),
    submit: vi.fn(async () => ok({ attempt: { ...attempt, input: undefined } as NativeAccountAttempt })),
    cancel: vi.fn(async () => ok({ attempt: { ...attempt, state: 'cancelled' as const } })),
  }
  const mutate = vi.fn(async () => ok({ ...namespace, revision: 4, value: { providers: { 'claude-subscription': {} } } }))
  const settings = {
    ensure: async () => {},
    getSnapshot: () => ({ view: { writable: true, namespaces: [namespace] } }),
    acceptView: (value: SettingsNamespaceView) => { namespace = value },
  } as unknown as SettingsDescribeFace
  const enabled = vi.fn()
  const controller = new NativeAccountsStore({ nativeAccounts, settings: { mutate } } as unknown as IApiClient, settings, enabled)
  const props = {
    available: true, useAccounts: bindSnapshotSelector(controller.store), watch: () => controller.watch(),
    reload: () => { void controller.load() }, begin: controller.begin.bind(controller),
    cancel: () => { void controller.cancel() }, submit: (code: string) => { void controller.submit(code) },
    enable: controller.enable.bind(controller), t: (key: string) => en[key as keyof typeof en],
  }
  return { controller, nativeAccounts, mutate, enabled, props, settings }
}

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('native product accounts', () => {
  it('loads sanitized metadata and explicitly enables the canonical Claude model without guessing capacity', async () => {
    const b = bench()
    await b.controller.load()
    await b.controller.enable('claude-code')
    expect(b.mutate).toHaveBeenCalledWith({ ns: 'llm-agent-cli', expectedRevision: 3, ops: [{
      op: 'set', path: ['providers', 'claude-subscription'], value: {
        displayName: 'Claude Code', models: [{ id: 'canonical-model', name: 'Model', efforts: ['high'] }],
      },
    }] })
    expect(b.enabled).toHaveBeenCalledOnce()
    await b.controller.enable('claude-code')
    await b.controller.enable('codex')
    expect(b.mutate).toHaveBeenCalledOnce()
    b.controller.dispose()
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

  it('shows a real login link, accepts a CLI-requested code, clears it, and refreshes on completion', async () => {
    const b = bench()
    b.nativeAccounts.poll.mockImplementation(async () => ok({ attempt: b.nativeAccounts.submit.mock.calls.length > 0
      ? { ...attempt, state: 'connected' as const } : attempt }))
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
