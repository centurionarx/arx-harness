import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'
import { openCodexConnection } from '../src/codex.ts'
import { codexAccountDriver } from '../src/drivers.ts'

/** The pinned app-server's stdio peer; only the external process is substituted. A thrown respond becomes a JSON-RPC error. */
function product(respond: (method: string, params: Record<string, unknown>) => unknown) {
  const stdout = new PassThrough(); const stdin = new PassThrough()
  let settle!: (outcome: SubprocessOutcome) => void
  let crash!: (error: Error) => void
  const done = new Promise<SubprocessOutcome>((resolve, reject) => { settle = resolve; crash = reject })
  const requests: Array<{ method: string; params: Record<string, unknown> }> = []
  const answers: Array<Record<string, unknown>> = []
  const send = (frame: object): void => { stdout.write(`${JSON.stringify(frame)}\n`) }
  stdin.on('data', (data) => {
    for (const line of String(data).trim().split('\n')) {
      const frame = JSON.parse(line) as { id?: string; method?: string; params: Record<string, unknown> }
      if (frame.method === undefined) { answers.push(frame); continue }
      if (frame.id === undefined) continue
      const request = { method: frame.method, params: frame.params }
      requests.push(request)
      queueMicrotask(() => {
        try { send({ jsonrpc: '2.0', id: frame.id, result: respond(request.method, request.params) }) }
        catch (error) { send({ jsonrpc: '2.0', id: frame.id, error: { code: -32000, message: (error as Error).message } }) }
      })
    }
  })
  const exit = (): void => { stdout.end(); settle({ exitCode: 0, signal: null }) }
  const terminate = vi.fn(exit)
  const waitForExit = vi.fn(async () => { await done.catch(() => { /* A failed spawn has already exited. */ }); return true })
  const handle: SubprocessHandle = { pid: -1, stdin, stdout, stderr: undefined, collected: {}, done, terminate, waitForExit }
  const spawn = vi.fn((_spec: SubprocessSpawnSpec) => handle)
  const driver = codexAccountDriver({ cwd: process.cwd(), env: {}, graceMs: 50, outputMaxBytes: 4096, spawn })
  return { driver, spawn, requests, answers, terminate, waitForExit, send, exit,
    crash: (error: Error) => { stdout.end(); crash(error) },
    notify: (params: object, method = 'account/login/completed') => { send({ jsonrpc: '2.0', method, params }) } }
}
const live = (): AbortSignal => new AbortController().signal

/**
 * A stand-in for the app-server's loopback callback listener: it answers each
 * request with the status `answer` picks and records every path it receives.
 * @param answer - the status for one received path.
 * @returns the listener, its port, and the received paths.
 */
async function callbackListener(answer: (path: string) => number): Promise<{ server: Server; port: number; paths: string[] }> {
  const paths: string[] = []
  const server = createServer((request, response) => {
    paths.push(request.url ?? '')
    const status = answer(request.url ?? '')
    response.writeHead(status)
    response.end(status === 204 ? undefined : 'callback page')
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  return { server, port: (server.address() as AddressInfo).port, paths }
}
/** The authorization address of a browser sign-in whose return address is `redirect`. */
const authorize = (redirect: string): string =>
  `https://auth.openai.com/oauth/authorize?client_id=app&redirect_uri=${encodeURIComponent(redirect)}`
/** A prompt answering with `lines` in order and then waiting until the attempt ends. */
function pasting(lines: string[], signal: AbortSignal) {
  return vi.fn(async (_input: string) => {
    const line = lines.shift()
    if (line !== undefined) return line
    return await new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('Sign-in cancelled')) }, { once: true })
    })
  })
}

describe('native Codex app-server connection', () => {
  it('refuses to start a process for an already cancelled caller', async () => {
    const host = product(() => ({}))
    const controller = new AbortController(); controller.abort()
    await expect(openCodexConnection({ cwd: process.cwd(), env: {}, graceMs: 50, signal: controller.signal, spawn: host.spawn }))
      .rejects.toThrow()
    expect(host.spawn).not.toHaveBeenCalled()
  })
  it('starts the pinned wrapper and closes the process tree when initialization fails', async () => {
    const host = product((method) => { if (method === 'initialize') throw new Error('unsupported client'); return {} })
    await expect(openCodexConnection({ cwd: process.cwd(), env: {}, graceMs: 50, signal: live(), spawn: host.spawn }))
      .rejects.toThrow('unsupported client')
    expect(host.spawn.mock.calls[0]![0].argv.slice(-2)).toEqual(['app-server', '--stdio'])
    expect(host.terminate).toHaveBeenCalledOnce()
    expect(host.waitForExit).toHaveBeenCalledOnce()
  })
  it('refuses product-initiated requests unless its owner accepts them', async () => {
    const host = product(() => ({}))
    const probe = await openCodexConnection({ cwd: process.cwd(), env: {}, graceMs: 50, signal: live(), spawn: host.spawn })
    host.send({ jsonrpc: '2.0', id: 'product-1', method: 'item/tool/call', params: {} })
    await vi.waitFor(() => { expect(host.answers).toHaveLength(1) })
    expect(host.answers[0]).toMatchObject({ id: 'product-1', error: { message: 'Native account probe does not accept product requests' } })
    await probe.close()
    const owned = product(() => ({}))
    const onRequest = vi.fn(async () => ({ accepted: true }))
    const connection = await openCodexConnection({
      cwd: process.cwd(), env: {}, graceMs: 50, signal: live(), spawn: owned.spawn, onRequest,
    })
    owned.send({ jsonrpc: '2.0', id: 'product-2', method: 'item/tool/call', params: { tool: 'x' } })
    await vi.waitFor(() => { expect(owned.answers).toHaveLength(1) })
    expect(owned.answers[0]).toMatchObject({ id: 'product-2', result: { accepted: true } })
    expect(onRequest).toHaveBeenCalledWith('item/tool/call', { tool: 'x' })
    await connection.close()
  })
  it('settles closed when the process fails and closes once however often it is asked', async () => {
    const host = product(() => ({}))
    const connection = await openCodexConnection({ cwd: process.cwd(), env: {}, graceMs: 50, signal: live(), spawn: host.spawn })
    host.crash(new Error('spawn lost'))
    await connection.closed
    await Promise.all([connection.close(), connection.close()])
    expect(host.terminate).toHaveBeenCalledOnce()
    expect(host.waitForExit).toHaveBeenCalledOnce()
  })
})

describe('native Codex account protocol', () => {
  it('reads all model pages while projecting only safe account and model facts', async () => {
    const host = product((method, params) => {
      if (method === 'account/read') return { account: { type: 'chatgpt', email: 'private@example.test', accessToken: 'secret' } }
      if (method === 'model/list') return params.cursor === 'next'
        ? { data: [{ model: 'm2', displayName: 'Second', supportedReasoningEfforts: [] }, { model: 'm3', displayName: 'Hidden', hidden: true }], nextCursor: null }
        : { data: [{ model: 'm1', displayName: 'First', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], nextCursor: 'next' }
      return {}
    })
    const view = await host.driver.describe(live())
    expect(view).toEqual({ availability: 'available', status: 'connected', authMode: 'subscription', models: [
      { id: 'm1', name: 'First', efforts: ['high'] }, { id: 'm2', name: 'Second', efforts: [] },
    ] })
    expect(JSON.stringify(view)).not.toContain('private')
    expect(host.requests.some(request => request.method === 'thread/start')).toBe(false)
    expect(host.waitForExit).toHaveBeenCalledOnce()
  })
  it('reports a signed-out product without listing models', async () => {
    const host = product(method => method === 'account/read' ? { account: null } : {})
    expect(await host.driver.describe(live())).toEqual({ availability: 'available', status: 'disconnected' })
    expect(host.requests.map(request => request.method)).toEqual(['initialize', 'account/read'])
  })
  it.each([
    ['apiKey', { authMode: 'api-key' }],
    ['enterprise', {}],
  ] as const)('maps a %s account without guessing model efforts', async (type, mode) => {
    const host = product(method => method === 'account/read' ? { account: { type } }
      : { data: [{ model: 'm1', displayName: 'First' }] })
    expect(await host.driver.describe(live())).toEqual({ availability: 'available', status: 'connected', ...mode,
      models: [{ id: 'm1', name: 'First', efforts: [] }] })
  })
  it.each([
    ['a non-object account response', () => [], 'Invalid native response'],
    ['a non-list model page', (method: string) => method === 'account/read' ? { account: { type: 'chatgpt' } } : { data: {} }, 'Invalid native model list'],
    ['an empty model id', (method: string) => method === 'account/read' ? { account: { type: 'chatgpt' } } : { data: [{ model: '', displayName: 'x' }] }, 'Invalid native response'],
    ['a repeated page cursor', (method: string) => method === 'account/read' ? { account: { type: 'chatgpt' } } : { data: [], nextCursor: 'again' }, 'repeated a cursor'],
  ] as const)('rejects %s and still closes the process tree', async (_case, respond, message) => {
    const host = product(respond)
    await expect(host.driver.describe(live())).rejects.toThrow(message)
    expect(host.waitForExit).toHaveBeenCalledOnce()
  })
  it('completes only the matching device login and never requests a paid turn', async () => {
    const host = product(method => method === 'account/login/start'
      ? { type: 'chatgptDeviceCode', loginId: 'own', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD' } : {})
    const notice = vi.fn()
    let completed = false
    const login = host.driver.login('device-code', live(), notice, async () => '').then(() => { completed = true })
    await vi.waitFor(() => { expect(notice).toHaveBeenCalled() })
    host.notify({ loginId: 'own', success: true }, 'account/updated')
    host.notify({ loginId: 'unrelated', success: true })
    await Promise.resolve()
    expect(completed).toBe(false)
    host.notify({ loginId: 'own', success: true })
    await login
    expect(notice).toHaveBeenCalledWith('https://auth.openai.com/codex/device', 'ABCD')
    expect(host.requests.map(request => request.method)).toEqual(['initialize', 'account/login/start'])
    expect(host.requests[1]!.params).toEqual({ type: 'chatgptDeviceCode' })
    expect(host.waitForExit).toHaveBeenCalledOnce()
  })
  it('accepts a completion the product reports before it answers the login request', async () => {
    // The product reports before answering, so it reaches the notifier through a holder.
    const channel: { report?: (params: object) => void } = {}
    const host = product((method) => {
      if (method !== 'account/login/start') return {}
      channel.report?.({ loginId: 'other', success: true })
      channel.report?.({ loginId: 'own', success: true })
      return { type: 'chatgpt', loginId: 'own', authUrl: 'https://auth.openai.com/authorize' }
    })
    channel.report = host.notify
    const notice = vi.fn()
    await host.driver.login('browser', live(), notice, async () => '')
    expect(notice).toHaveBeenCalledWith('https://auth.openai.com/authorize', undefined)
    expect(host.requests[1]!.params).toEqual({ type: 'chatgpt' })
  })
  it('fails a login the product reports as unsuccessful', async () => {
    const host = product(method => method === 'account/login/start' ? { type: 'chatgpt', loginId: 'own', authUrl: 'https://auth.openai.com/authorize' } : {})
    const login = host.driver.login('browser', live(), () => { host.notify({ loginId: 'own', success: false }) }, async () => '')
    await expect(login).rejects.toThrow('Native sign-in failed')
    expect(host.waitForExit).toHaveBeenCalledOnce()
  })
  it('fails a login whose product process exits before completion', async () => {
    const host = product(method => method === 'account/login/start' ? { type: 'chatgpt', loginId: 'own', authUrl: 'https://auth.openai.com/authorize' } : {})
    await expect(host.driver.login('browser', live(), () => { host.exit() }, async () => '')).rejects.toThrow('Native login process exited')
  })
  it('rejects a login cancelled while its address is being published', async () => {
    const host = product(method => method === 'account/login/start' ? { type: 'chatgpt', loginId: 'own', authUrl: 'https://auth.openai.com/authorize' } : {})
    const controller = new AbortController()
    await expect(host.driver.login('browser', controller.signal, () => { controller.abort() }, async () => '')).rejects.toThrow('cancelled')
    expect(host.waitForExit).toHaveBeenCalledOnce()
  })
  it('forwards a pasted return address to the loopback port the sign-in names', async () => {
    const listener = await callbackListener(path => path.includes('state=stale') ? 400 : 204)
    const redirect = `http://localhost:${String(listener.port)}/auth/callback`
    const host = product(method => method === 'account/login/start'
      ? { type: 'chatgpt', loginId: 'own', authUrl: authorize(redirect) } : {})
    const controller = new AbortController()
    const prompt = pasting([
      'not an address',
      'http://localhost:1/auth/callback?code=other-port',
      `${redirect.replace('/auth/callback', '/elsewhere')}?code=other-path`,
      redirect,
      `${redirect}?code=old&state=stale`,
      `  ${redirect}?code=new&state=live  `,
    ], controller.signal)
    const login = host.driver.login('browser', controller.signal, () => {}, prompt)
    await vi.waitFor(() => { expect(listener.paths).toHaveLength(2) })
    host.notify({ loginId: 'own', success: true })
    await login
    listener.server.close()
    expect(listener.paths).toEqual(['/auth/callback?code=old&state=stale', '/auth/callback?code=new&state=live'])
    expect(prompt).toHaveBeenCalledTimes(6)
    expect(prompt.mock.calls.every(([input]) => input === 'redirect-url')).toBe(true)
  })
  it('asks again when the return listener cannot be reached, until the attempt ends', async () => {
    const listener = await callbackListener(() => 204)
    const redirect = `http://127.0.0.1:${String(listener.port)}/auth/callback`
    await new Promise<void>((resolve) => { listener.server.close(() => { resolve() }) })
    const host = product(method => method === 'account/login/start'
      ? { type: 'chatgpt', loginId: 'own', authUrl: authorize(redirect) } : {})
    const controller = new AbortController()
    const prompt = pasting([`${redirect}?code=late`], controller.signal)
    const login = host.driver.login('browser', controller.signal, () => {}, prompt)
    await vi.waitFor(() => { expect(prompt).toHaveBeenCalledTimes(2) })
    controller.abort()
    await expect(login).rejects.toThrow('cancelled')
  })
  it.each([
    ['names no return address', 'https://auth.openai.com/oauth/authorize?client_id=app'],
    ['names an unreadable return address', authorize('not a url')],
    ['returns to another host', authorize('http://example.test:1455/auth/callback')],
    ['returns over HTTPS', authorize('https://localhost:1455/auth/callback')],
    ['returns to a default port', authorize('http://localhost/auth/callback')],
  ])('asks for no pasted address when the sign-in %s', async (_case, authUrl) => {
    const host = product(method => method === 'account/login/start' ? { type: 'chatgpt', loginId: 'own', authUrl } : {})
    const prompt = vi.fn(async () => '')
    await host.driver.login('browser', live(), () => { host.notify({ loginId: 'own', success: true }) }, prompt)
    expect(prompt).not.toHaveBeenCalled()
  })
  it('cancels a pending browser login and awaits the process tree', async () => {
    const host = product(method => method === 'account/login/start' ? { type: 'chatgpt', loginId: 'own', authUrl: 'https://auth.openai.com/authorize' } : {})
    const controller = new AbortController()
    const notice = vi.fn()
    const login = host.driver.login('browser', controller.signal, notice, async () => '')
    await vi.waitFor(() => { expect(notice).toHaveBeenCalled() })
    controller.abort()
    await expect(login).rejects.toThrow('cancelled')
    expect(host.terminate).toHaveBeenCalledOnce()
    expect(host.waitForExit).toHaveBeenCalledOnce()
  })
})
