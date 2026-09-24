import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'
import { codexAccountDriver } from '../src/drivers.ts'

function product(respond: (method: string, params: Record<string, unknown>) => unknown) {
  const stdout = new PassThrough(); const stdin = new PassThrough()
  let settle!: (outcome: SubprocessOutcome) => void
  const done = new Promise<SubprocessOutcome>(resolve => { settle = resolve })
  const requests: Array<{ method: string; params: Record<string, unknown> }> = []
  stdin.on('data', data => {
    for (const line of String(data).trim().split('\n')) {
      const request = JSON.parse(line) as { id?: string; method: string; params: Record<string, unknown> }
      if (!request.id) continue
      requests.push(request)
      queueMicrotask(() => stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: respond(request.method, request.params) })}\n`))
    }
  })
  const terminate = vi.fn(() => { stdout.end(); settle({ exitCode: 0, signal: null }) })
  const waitForExit = vi.fn(async () => { await done; return true })
  const handle: SubprocessHandle = { pid: -1, stdin, stdout, stderr: undefined, collected: {}, done, terminate, waitForExit }
  const spawn = vi.fn((_spec: SubprocessSpawnSpec) => handle)
  const driver = codexAccountDriver({ cwd: process.cwd(), env: {}, graceMs: 50, outputMaxBytes: 4096, spawn })
  return { driver, requests, terminate, waitForExit,
    notify: (params: object) => stdout.write(`${JSON.stringify({ method: 'account/login/completed', params })}\n`) }
}
describe('native Codex account protocol', () => {
  it('reads all model pages while projecting only safe account and model facts', async () => {
    const host = product((method, params) => {
      if (method === 'account/read') return { account: { type: 'chatgpt', email: 'private@example.test', accessToken: 'secret' } }
      if (method === 'model/list') return params.cursor === 'next'
        ? { data: [{ model: 'm2', displayName: 'Second', supportedReasoningEfforts: [] }], nextCursor: null }
        : { data: [{ model: 'm1', displayName: 'First', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], nextCursor: 'next' }
      return {}
    })
    const view = await host.driver.describe(new AbortController().signal)
    expect(view).toEqual({ availability: 'available', status: 'connected', authMode: 'subscription', models: [
      { id: 'm1', name: 'First', efforts: ['high'] }, { id: 'm2', name: 'Second', efforts: [] },
    ] })
    expect(JSON.stringify(view)).not.toContain('private')
    expect(host.requests.some(request => request.method === 'thread/start')).toBe(false)
    expect(host.waitForExit).toHaveBeenCalledOnce()
  })
  it('completes only the matching device login and never requests a paid turn', async () => {
    const host = product(method => method === 'account/login/start'
      ? { type: 'chatgptDeviceCode', loginId: 'own', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD' } : {})
    const notice = vi.fn()
    let completed = false
    const login = host.driver.login('device-code', new AbortController().signal, notice, async () => '').then(() => { completed = true })
    await vi.waitFor(() => expect(notice).toHaveBeenCalled())
    host.notify({ loginId: 'unrelated', success: true })
    await Promise.resolve()
    expect(completed).toBe(false)
    host.notify({ loginId: 'own', success: true })
    await login
    expect(notice).toHaveBeenCalledWith('https://auth.openai.com/codex/device', 'ABCD')
    expect(host.requests.map(request => request.method)).toEqual(['initialize', 'account/login/start'])
    expect(host.waitForExit).toHaveBeenCalledOnce()
  })
  it('cancels a pending browser login and awaits the process tree', async () => {
    const host = product(method => method === 'account/login/start' ? { type: 'chatgpt', loginId: 'own', authUrl: 'https://auth.openai.com/authorize' } : {})
    const controller = new AbortController()
    const notice = vi.fn()
    const login = host.driver.login('browser', controller.signal, notice, async () => '')
    await vi.waitFor(() => expect(notice).toHaveBeenCalled())
    controller.abort()
    await expect(login).rejects.toThrow('cancelled')
    expect(host.terminate).toHaveBeenCalledOnce()
    expect(host.waitForExit).toHaveBeenCalledOnce()
  })
})
