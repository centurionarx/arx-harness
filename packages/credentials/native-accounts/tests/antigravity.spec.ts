import { PassThrough } from 'node:stream'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'
import { antigravityAccountDriver } from '../src/drivers.ts'

/** An existing file stands in for the installed CLI; every process it would start is scripted. */
const AGY = process.execPath
/** Output of `agy models` without a signed-in account, as Antigravity CLI 1.5.16 prints it. */
const SIGNED_OUT_STDERR = 'Fetching available models...\nError: Please sign in to view available models. Launch the CLI without arguments to sign in.\n'
/** The opening of `agy acp --login`, as Antigravity CLI 1.5.16 prints it. */
const LOGIN_OPENING = 'Open this link in a browser to log in with Google:\n\n'
  + '  https://accounts.google.com/o/oauth2/auth?access_type=offline&response_type=code&state=s\n\n'
  + 'Then paste the authorization code, or the full URL of the page you land on, and press Enter:\n'

interface Child {
  spec: SubprocessSpawnSpec
  handle: SubprocessHandle
  stdout: PassThrough
  stderr: PassThrough
  written: string[]
  waitForExit: Mock<SubprocessHandle['waitForExit']>
  exit(code: number): void
}
type Listing = { exitCode: number; stdout?: string; stderr?: string; lossy?: 'stdout' | 'stderr' } | Error
const signedOut = (): Listing => ({ exitCode: 1, stderr: SIGNED_OUT_STDERR })
const signedIn = (stdout: string) => (): Listing => ({ exitCode: 0, stdout })
/** Every process the driver starts; `models` and `acp --login` children are scripted per test. */
function products(
  script: { models?: (call: number) => Listing; login?: (child: Child) => void } = {},
  installed: { executable?: string } = { executable: AGY },
) {
  const children: Child[] = []
  let listings = 0
  const spawn = vi.fn((spec: SubprocessSpawnSpec): SubprocessHandle => {
    const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough()
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
    const listing = spec.argv[1] === 'models' ? (script.models ?? signedOut)(listings++) : undefined
    const read = (text: string, lossy: boolean) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy }) })
    const collected = listing === undefined || listing instanceof Error ? {} : {
      stdout: read(listing.stdout ?? '', listing.lossy === 'stdout'),
      stderr: read(listing.stderr ?? '', listing.lossy === 'stderr'),
    }
    const waitForExit = vi.fn<SubprocessHandle['waitForExit']>(async () => {
      await done.catch(() => { /* A refused spawn has no process to wait for. */ })
      return true
    })
    const handle: SubprocessHandle = { pid: -1, stdin, stdout, stderr, done, collected, terminate: vi.fn(() => { exit(143) }), waitForExit }
    const child: Child = { spec, handle, stdout, stderr, written, waitForExit, exit }
    children.push(child)
    spec.signal?.addEventListener('abort', () => { exit(143) }, { once: true })
    if (listing instanceof Error) { exited = true; refuse(listing) }
    else if (listing !== undefined) queueMicrotask(() => { exit(listing.exitCode) })
    else script.login?.(child)
    return handle
  })
  const driver = antigravityAccountDriver({ cwd: process.cwd(), env: {}, graceMs: 50, outputMaxBytes: 4096, spawn }, installed.executable)
  return { driver, spawn, children }
}
const live = (): AbortSignal => new AbortController().signal

describe('native Antigravity account status', () => {
  it.each([
    ['no executable is configured', {}],
    ['the configured executable does not exist', { executable: '/nonexistent/agy' }],
  ])('reports the product unavailable when %s', async (_case, installed) => {
    const host = products({}, installed)
    expect(await host.driver.describe(live())).toEqual({ availability: 'unavailable', status: 'unknown' })
    expect(host.spawn).not.toHaveBeenCalled()
  })
  it('reads the CLI signed-out diagnostic as a disconnected account', async () => {
    const host = products()
    expect(await host.driver.describe(live())).toEqual({ availability: 'available', status: 'disconnected' })
    expect(host.children.map(child => child.spec.argv)).toEqual([[AGY, 'models']])
    expect(host.children[0]!.waitForExit).toHaveBeenCalledOnce()
  })
  it('lists one model per line by its leading id', async () => {
    const host = products({ models: signedIn('gemini-3-pro  Gemini 3 Pro\n\n  gemini-3-flash\n') })
    expect(await host.driver.describe(live())).toEqual({ availability: 'available', status: 'connected', models: [
      { id: 'gemini-3-pro', name: 'Gemini 3 Pro' },
      { id: 'gemini-3-flash', name: 'gemini-3-flash' },
    ] })
  })
  it.each([
    ['a title line', 'Available models:\ngemini-3-pro  Gemini 3 Pro\n'],
    ['a table header', 'ID  NAME\ngemini-3-pro  Gemini 3 Pro\n'],
    ['a marked line', '* Gemini 3 Flash\ngemini-3-pro  Gemini 3 Pro\n'],
  ])('skips %s that names no model id', async (_case, stdout) => {
    const host = products({ models: signedIn(stdout) })
    expect(await host.driver.describe(live())).toMatchObject({ status: 'connected', models: [{ id: 'gemini-3-pro', name: 'Gemini 3 Pro' }] })
  })
  it('keeps the account connected without models when no line names a model id', async () => {
    const host = products({ models: signedIn('Available models:\nDefault\n') })
    expect(await host.driver.describe(live())).toEqual({ availability: 'available', status: 'connected' })
  })
  it.each([
    ['another failure with exit code 1', { exitCode: 1, stderr: 'Error: network unreachable\n' }, 'Native status unavailable'],
    ['an unexpected exit code', { exitCode: 2, stdout: 'gemini-3-pro\n' }, 'Native status unavailable'],
    ['truncated output', { exitCode: 0, stdout: 'gemini', lossy: 'stdout' }, 'exceeded its limit'],
    ['truncated diagnostics', { exitCode: 1, stderr: 'Fetching', lossy: 'stderr' }, 'exceeded its limit'],
  ] as const)('refuses %s from the model listing', async (_case, listing, message) => {
    const host = products({ models: () => listing })
    await expect(host.driver.describe(live())).rejects.toThrow(message)
    expect(host.children[0]!.waitForExit).toHaveBeenCalledOnce()
  })
  it('reports a model listing the host refuses to start', async () => {
    const host = products({ models: () => Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }) })
    await expect(host.driver.describe(live())).rejects.toThrow('spawn EACCES')
    expect(host.children[0]!.waitForExit).toHaveBeenCalledOnce()
  })
  it('does not start the CLI for a cancelled probe', async () => {
    const controller = new AbortController(); controller.abort()
    const host = products()
    await expect(host.driver.describe(controller.signal)).rejects.toThrow()
    expect(host.spawn).not.toHaveBeenCalled()
  })
  it('discards a listing that completes after its probe was cancelled', async () => {
    const controller = new AbortController()
    const host = products({ models: () => { queueMicrotask(() => { controller.abort() }); return { exitCode: 0, stdout: 'gemini-3-pro\n' } } })
    await expect(host.driver.describe(controller.signal)).rejects.toThrow()
  })
})

describe('native Antigravity sign-in', () => {
  it('relays only the Google sign-in address, answers the code prompt, and confirms the account', async () => {
    const notice = vi.fn()
    const host = products({
      models: call => call === 0 ? { exitCode: 0, stdout: 'gemini-3-pro\n' } : signedOut(),
      login: (child) => {
        child.stdout.write('Help: https://antigravity.google/docs \n')
        child.stdout.write(LOGIN_OPENING)
        child.handle.stdin!.once('data', () => { queueMicrotask(() => { child.exit(0) }) })
      },
    })
    await host.driver.login('browser', live(), notice, async () => 'one-time-code')
    expect(notice).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth?access_type=offline&response_type=code&state=s')
    expect(notice.mock.calls.flat()).not.toContain('https://antigravity.google/docs')
    const login = host.children.find(child => child.spec.argv[1] === 'acp')!
    expect(login.spec.argv).toEqual([AGY, 'acp', '--login'])
    expect(login.written).toEqual(['one-time-code\n'])
    expect(login.waitForExit).toHaveBeenCalledOnce()
    expect(host.children.map(child => child.spec.argv.slice(1))).toEqual([['acp', '--login'], ['models']])
  })
  it('fails when the CLI rejects the pasted code', async () => {
    const host = products({ login: (child) => {
      child.stdout.write(LOGIN_OPENING)
      child.handle.stdin!.once('data', () => {
        child.stdout.write('couldn\'t log in: token exchange failed: oauth2: "invalid_grant" "Malformed auth code."\n')
        queueMicrotask(() => { child.exit(1) })
      })
    } })
    await expect(host.driver.login('browser', live(), vi.fn(), async () => 'wrong')).rejects.toThrow('Native sign-in failed')
    expect(host.children.map(child => child.spec.argv[1])).toEqual(['acp'])
  })
  it('fails when the CLI exits cleanly but still reports no signed-in account', async () => {
    const host = products({ login: (child) => { queueMicrotask(() => { child.exit(0) }) } })
    await expect(host.driver.login('browser', live(), vi.fn(), async () => '')).rejects.toThrow('Native sign-in incomplete')
  })
  it('cancels a pending code prompt without writing to the CLI', async () => {
    const controller = new AbortController()
    let answer!: (code: string) => void
    const host = products({ login: (child) => { child.stdout.write(LOGIN_OPENING) } })
    const login = host.driver.login('browser', controller.signal, vi.fn(), () => new Promise<string>((resolve) => { answer = resolve }))
    await vi.waitFor(() => { expect(answer).toBeDefined() })
    controller.abort()
    answer('late-code')
    await expect(login).rejects.toThrow()
    expect(host.children[0]!.written).toEqual([])
    expect(host.children[0]!.waitForExit).toHaveBeenCalledOnce()
  })
  it('refuses to sign in without a configured executable', async () => {
    const host = products({}, {})
    await expect(host.driver.login('browser', live(), vi.fn(), async () => '')).rejects.toThrow('Native product unavailable')
    expect(host.spawn).not.toHaveBeenCalled()
  })
})
