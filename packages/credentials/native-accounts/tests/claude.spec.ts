import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'
import { claudeAccountDriver, claudeAccountExecutable, claudePlatformExecutable } from '../src/drivers.ts'

/**
 * The Agent SDK's product protocol is substituted; its spawn callback still
 * reaches the shared process owner, and its empty prompt stream is consumed
 * the way the SDK consumes it.
 */
const sdk = vi.hoisted(() => ({
  models: async (): Promise<unknown[]> => [],
  closed: 0,
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: {
    prompt: AsyncIterable<never>
    options: {
      cwd: string
      abortController: AbortController
      spawnClaudeCodeProcess(request: object): unknown
      stderr(data: string): void
    }
  }) => {
    options.spawnClaudeCodeProcess({ command: 'claude-product', args: ['--input-format', 'stream-json'],
      cwd: options.cwd, env: {}, signal: options.abortController.signal })
    options.stderr('raw product diagnostic')
    const consumed = (async () => { for await (const _message of prompt) { /* The account probe sends no message. */ } })()
    return {
      supportedModels: () => sdk.models(),
      close: () => { sdk.closed += 1; void consumed },
    }
  },
}))

interface Child {
  spec: SubprocessSpawnSpec
  handle: SubprocessHandle
  /** The product's output streams, writable by the scripted product. */
  stdout: PassThrough
  stderr: PassThrough
  written: string[]
  /** The handle's process-tree wait, observed to prove every child was released. */
  waitForExit: Mock<SubprocessHandle['waitForExit']>
  exit(code: number): void
}
type Status = { exitCode: number; text: string; lossy?: boolean } | Error
const signedOut = (): Status => ({ exitCode: 1, text: '{"loggedIn":false}' })
/** Every product process the driver starts; status and login children are scripted per test. */
function products(script: {
  status?: (call: number) => Status
  login?: (child: Child) => void
} = {}) {
  const children: Child[] = []
  let statusCalls = 0
  const spawn = vi.fn((spec: SubprocessSpawnSpec): SubprocessHandle => {
    const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough()
    stderr.setEncoding('utf8')
    let settle!: (outcome: SubprocessOutcome) => void
    let refuse!: (error: Error) => void
    const done = new Promise<SubprocessOutcome>((resolve, reject) => { settle = resolve; refuse = reject })
    const written: string[] = []
    stdin.on('data', (data) => { written.push(String(data)) })
    let exited = false
    const exit = (code: number): void => {
      if (exited) return
      exited = true; stdout.end(); stderr.end(); settle({ exitCode: code, signal: null })
    }
    const role = spec.argv.slice(1, 3).join(' ')
    const status = role === 'auth status' ? (script.status ?? signedOut)(statusCalls++) : undefined
    const collected = status === undefined || status instanceof Error ? {}
      : { stdout: { readFrom: () => ({ text: status.text, nextOffset: status.text.length, lossy: status.lossy ?? false }) } }
    const waitForExit = vi.fn<SubprocessHandle['waitForExit']>(async () => {
      await done.catch(() => { /* A refused spawn has no process to wait for. */ })
      return true
    })
    const handle: SubprocessHandle = { pid: -1, stdin, stdout, stderr, done, collected, terminate: vi.fn(() => { exit(143) }), waitForExit }
    const child: Child = { spec, handle, stdout, stderr, written, waitForExit, exit }
    children.push(child)
    spec.signal?.addEventListener('abort', () => { exit(143) }, { once: true })
    if (status instanceof Error) { exited = true; refuse(status) }
    else if (status !== undefined) queueMicrotask(() => { exit(status.exitCode) })
    else if (role === 'auth login') script.login?.(child)
    return handle
  })
  const driver = claudeAccountDriver({ cwd: process.cwd(), env: {}, graceMs: 50, outputMaxBytes: 256, spawn })
  return { driver, spawn, children }
}
const live = (): AbortSignal => new AbortController().signal
const signedIn = (authMethod: string) => (): Status => ({ exitCode: 0, text: JSON.stringify({ loggedIn: true, authMethod, email: 'private@example.test' }) })

afterEach(() => {
  vi.restoreAllMocks()
  sdk.models = async () => []
  sdk.closed = 0
})

describe('Claude platform executable', () => {
  it.each([
    [{ platform: 'linux', arch: 'x64', musl: false }, '@anthropic-ai/claude-agent-sdk-linux-x64', 'claude'],
    [{ platform: 'linux', arch: 'arm64', musl: true }, '@anthropic-ai/claude-agent-sdk-linux-arm64-musl', 'claude'],
    [{ platform: 'win32', arch: 'x64', musl: false }, '@anthropic-ai/claude-agent-sdk-win32-x64', 'claude.exe'],
    [{ platform: 'darwin', arch: 'arm64', musl: false }, '@anthropic-ai/claude-agent-sdk-darwin-arm64', 'claude'],
  ] as const)('names the SDK package for %o', (host, pkg, file) => {
    expect(claudePlatformExecutable(host)).toEqual({ pkg, file })
  })
  it('resolves the executable shipped with the pinned SDK for this host', () => {
    expect(claudeAccountExecutable()).toMatch(/[\\/]claude(\.exe)?$/)
  })
  it('selects the musl package on a Linux host without a glibc runtime', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('ppc64')
    vi.spyOn(process.report, 'getReport').mockReturnValue({ header: {} })
    expect(() => claudeAccountExecutable()).toThrow('claude-agent-sdk-linux-ppc64-musl')
  })
})

describe('native Claude account status', () => {
  it('reports the product unavailable when this host has no shipped executable', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('aix')
    const host = products()
    expect(await host.driver.describe(live())).toEqual({ availability: 'unavailable', status: 'unknown' })
    expect(host.spawn).not.toHaveBeenCalled()
  })
  it('reads a signed-out status without starting the model protocol', async () => {
    const host = products()
    expect(await host.driver.describe(live())).toEqual({ availability: 'available', status: 'disconnected' })
    expect(host.children.map(child => child.spec.argv.slice(1))).toEqual([['auth', 'status', '--json']])
    expect(host.children[0]!.waitForExit).toHaveBeenCalledOnce()
  })
  it('projects a subscription account and its models without account identity or raw diagnostics', async () => {
    sdk.models = async () => [
      { value: 'default', displayName: 'Default', resolvedModel: 'canonical-model', supportedEffortLevels: ['low', 'high'] },
      { value: 'fast', displayName: 'Fast' },
    ]
    const host = products({ status: signedIn('claude.ai') })
    const view = await host.driver.describe(live())
    expect(view).toEqual({ availability: 'available', status: 'connected', authMode: 'subscription', models: [
      { id: 'default', name: 'Default', resolvedModel: 'canonical-model', efforts: ['low', 'high'] },
      { id: 'fast', name: 'Fast' },
    ] })
    expect(JSON.stringify(view)).not.toContain('private')
    const model = host.children.find(child => child.spec.argv[0] === 'claude-product')!
    expect(model.spec.argv).toEqual(['claude-product', '--input-format', 'stream-json'])
    expect(model.written).toEqual([])
    expect(model.waitForExit).toHaveBeenCalledOnce()
    expect(sdk.closed).toBe(1)
  })
  it.each([
    ['api_key', { authMode: 'api-key' }],
    ['oauth_token', {}],
  ] as const)('keeps a %s account connected when model discovery fails', async (method, mode) => {
    sdk.models = () => Promise.reject(new Error('protocol unavailable'))
    const host = products({ status: signedIn(method) })
    expect(await host.driver.describe(live())).toEqual({ availability: 'available', status: 'connected', ...mode })
  })
  it('stops model discovery when its caller cancels', async () => {
    const controller = new AbortController()
    sdk.models = async () => { controller.abort(); return [] }
    const host = products({ status: signedIn('claude.ai') })
    expect(await host.driver.describe(controller.signal)).toMatchObject({ status: 'connected', models: [] })
  })
  it.each([
    ['an unexpected exit code', { exitCode: 2, text: '{}' }, 'Native status unavailable'],
    ['truncated output', { exitCode: 0, text: '{"loggedIn":', lossy: true }, 'exceeded its limit'],
    ['a non-object document', { exitCode: 0, text: '[]' }, 'Invalid native response'],
  ] as const)('refuses %s from the status command', async (_case, status, message) => {
    const host = products({ status: () => status })
    await expect(host.driver.describe(live())).rejects.toThrow(message)
    expect(host.children[0]!.waitForExit).toHaveBeenCalledOnce()
  })
  it('reports a status command the host refuses to start', async () => {
    const host = products({ status: () => Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) })
    await expect(host.driver.describe(live())).rejects.toThrow('spawn ENOENT')
    expect(host.children[0]!.waitForExit).toHaveBeenCalledOnce()
  })
  it('does not start a status command for a cancelled probe', async () => {
    const controller = new AbortController(); controller.abort()
    const host = products()
    await expect(host.driver.describe(controller.signal)).rejects.toThrow()
    expect(host.spawn).not.toHaveBeenCalled()
  })
  it('discards a status that completes after its probe was cancelled', async () => {
    const controller = new AbortController()
    const host = products({ status: () => { queueMicrotask(() => { controller.abort() }); return { exitCode: 0, text: '{"loggedIn":true}' } } })
    await expect(host.driver.describe(controller.signal)).rejects.toThrow()
  })
})

describe('native Claude sign-in', () => {
  it('relays only sign-in addresses, answers the CLI code prompt, and confirms a subscription', async () => {
    const notice = vi.fn()
    const host = products({
      status: signedIn('claude.ai'),
      login: (child) => {
        child.stdout.write('Docs: https://example.com/help \nOpen \x1b[1mhttps://claude.com/oauth/authorize?state=s\x1b[0m\n')
        child.stderr.write('Paste code here if prompted > ')
        child.handle.stdin!.once('data', () => {
          child.stdout.emit('data', Buffer.from('Signed in.\n'))
          queueMicrotask(() => { child.exit(0) })
        })
      },
    })
    await host.driver.login('browser', live(), notice, async () => 'one-time-code')
    expect(notice).toHaveBeenCalledWith('https://claude.com/oauth/authorize?state=s')
    expect(notice.mock.calls.flat()).not.toContain('https://example.com/help')
    const login = host.children.find(child => child.spec.argv[2] === 'login')!
    expect(login.spec.argv.slice(1)).toEqual(['auth', 'login', '--claudeai'])
    expect(login.written).toEqual(['one-time-code\n'])
    expect(login.waitForExit).toHaveBeenCalledOnce()
  })
  it.each([
    ['exits with an error', 1, signedIn('claude.ai'), 'Native sign-in failed'],
    ['signs in without a subscription', 0, signedIn('api_key'), 'subscription sign-in incomplete'],
  ] as const)('fails when the CLI %s', async (_case, code, status, message) => {
    const host = products({ status, login: (child) => { queueMicrotask(() => { child.exit(code) }) } })
    await expect(host.driver.login('browser', live(), vi.fn(), async () => '')).rejects.toThrow(message)
  })
  it('stops reading and terminates the CLI when its output carries a malformed address', async () => {
    const notice = vi.fn()
    const host = products({ login: (child) => {
      child.stdout.write('Open https://[claude.com/oauth \n')
      child.stdout.write('Then https://claude.com/oauth/late \n')
    } })
    const failure = host.driver.login('browser', live(), notice, async () => '')
    await expect(failure).rejects.toThrow('Native sign-in output could not be relayed')
    await expect(failure).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'Invalid URL' }) })
    expect(notice).not.toHaveBeenCalled()
  })
  it('cancels a pending code prompt without writing to the CLI', async () => {
    const controller = new AbortController()
    let answer!: (code: string) => void
    const notice = vi.fn()
    const host = products({ login: (child) => { child.stdout.write('Paste code here if prompted > ') } })
    const login = host.driver.login('browser', controller.signal, notice, () => new Promise<string>((resolve) => { answer = resolve }))
    await vi.waitFor(() => { expect(answer).toBeDefined() })
    controller.abort()
    host.children[0]!.stdout.emit('data', Buffer.from('Open https://claude.com/after-cancel \n'))
    answer('late-code')
    await expect(login).rejects.toThrow()
    expect(host.children[0]!.written).toEqual([])
    expect(notice).not.toHaveBeenCalled()
  })
  it('contains a withdrawn code prompt while the CLI exits', async () => {
    const host = products({ login: (child) => {
      child.stdout.write('Paste code here if prompted > ')
      queueMicrotask(() => { child.exit(1) })
    } })
    await expect(host.driver.login('browser', live(), vi.fn(), () => Promise.reject(new Error('withdrawn')))).rejects.toThrow('Native sign-in failed')
  })
  it('does not start the CLI for a cancelled sign-in', async () => {
    const controller = new AbortController(); controller.abort()
    const host = products()
    await expect(host.driver.login('browser', controller.signal, vi.fn(), async () => '')).rejects.toThrow()
    expect(host.spawn).not.toHaveBeenCalled()
  })
})
