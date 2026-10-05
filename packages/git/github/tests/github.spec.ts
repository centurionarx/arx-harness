import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialRef } from '@arx-ai/arx-credentials'
import { AuthorizationDeclinedError } from '@arx-ai/arx-authorization'
import type { AuthorizationInteraction, AuthorizationPrompt } from '@arx-ai/arx-authorization'
import GithubDefault, { GithubService } from '../src/index.ts'
import { DEFAULT_CONFIG, GITHUB_CREDENTIAL_KEY } from '../src/config.ts'
import { gate, harness, recordConfig } from './harness.ts'

const SECRET = 'fixture-PAT-MUST-NOT-LEAK'
const account = { id: 42, login: 'octocat', html_url: 'https://github.com/octocat' }
const repo = { id: 7, owner: { login: 'octocat' }, name: 'hello', private: true, default_branch: 'main', html_url: 'https://github.com/octocat/hello' }
const closes: (() => Promise<void>)[] = []
const fetchMock = vi.fn<typeof fetch>()
const signal = () => new AbortController().signal
function json(value: unknown, headers: HeadersInit = {}) {
  const responseHeaders = new Headers(headers)
  if (!responseHeaders.has('content-type')) responseHeaders.set('content-type', 'application/json')
  return new Response(JSON.stringify(value), { headers: responseHeaders })
}
function requestUrl(input: Parameters<typeof fetch>[0] | undefined): URL {
  if (input === undefined) throw new Error('expected a recorded fetch call')
  return new URL(input instanceof Request ? input.url : input)
}
async function drainMicrotasks() {
  for (let turn = 0; turn < 32; turn++) await Promise.resolve()
}
async function boot(config = recordConfig) {
  vi.stubGlobal('fetch', fetchMock)
  const h = await harness(config)
  closes.push(h.close)
  return h
}
async function connected(config = recordConfig) {
  const h = await boot(config)
  await h.memory.modifyRecord(GITHUB_CREDENTIAL_KEY, async () => ({ kind: 'api-key', key: SECRET }))
  return h
}
function interaction(answer = SECRET): AuthorizationInteraction {
  return { notify() {}, async prompt(prompt) { expect(prompt.kind).toBe('secret'); return answer } }
}
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('GitHub Loader authorization', () => {
  it('exports one service class and defaults to no ambient credential or flow', async () => {
    expect(GithubDefault).toBe(GithubService)
    const h = await boot(DEFAULT_CONFIG)
    expect(h.ctx.authorization.list()).toEqual([])
    expect(await h.service.account({}, signal())).toEqual({ state: 'unconfigured', writable: false })
    await expect(h.service.repositories({ page: 1 }, signal())).rejects.toThrow('GitHub operation failed')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.memory.commits).toEqual([])
  })

  it('prompts privately and reports authorized only after the actual record commit', async () => {
    const h = await boot()
    expect(await h.service.account({}, signal())).toEqual({ state: 'disconnected', writable: true, authFlowKey: GITHUB_CREDENTIAL_KEY })
    const events: string[] = []
    const prompts: AuthorizationPrompt[] = []
    h.ctx.on('credentials/record-updated', (key) => { events.push('commit:' + key) })
    h.ctx.on('authorization/settled', (_key, status) => { events.push(status) })
    const result = await h.ctx.authorization.begin({ key: GITHUB_CREDENTIAL_KEY, interaction: {
      notify(notice) { expect(JSON.stringify(notice)).not.toContain(SECRET) },
      async prompt(prompt) { prompts.push(prompt); return SECRET },
    } })
    expect(result).toEqual({ status: 'authorized' })
    expect(prompts).toHaveLength(1)
    expect(prompts[0]?.kind).toBe('secret')
    expect(await h.memory.readRecord(GITHUB_CREDENTIAL_KEY)).toEqual({ kind: 'api-key', key: SECRET })
    expect(events).toEqual(['commit:' + GITHUB_CREDENTIAL_KEY, 'authorized'])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.stringify(h.ctx.authorization.list())).not.toContain(SECRET)
  })

  it.each(['', ' token', 'token ', 'a b', 'a\tb', 'a\nb', 'é', '\u007f', 'x'.repeat(4097)])('rejects invalid PAT without publishing a record %#', async (answer) => {
    const h = await boot()
    await expect(h.ctx.authorization.begin({ key: GITHUB_CREDENTIAL_KEY, interaction: interaction(answer) })).rejects.toThrow('GitHub operation failed')
    expect(await h.memory.readRecord(GITHUB_CREDENTIAL_KEY)).toBeUndefined()
    expect(h.memory.commits).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts visible ASCII at the configured byte limit', async () => {
    const h = await boot({ ...recordConfig, patBytes: 3 })
    await expect(h.ctx.authorization.begin({ key: GITHUB_CREDENTIAL_KEY, interaction: interaction('!~A') })).resolves.toEqual({ status: 'authorized' })
    expect(await h.memory.readRecord(GITHUB_CREDENTIAL_KEY)).toEqual({ kind: 'api-key', key: '!~A' })
  })

  it('keeps reference credentials read-only and resolves their rotation per operation', async () => {
    const ref = credentialRef('FIXTURE_GITHUB_TOKEN')
    const h = await boot({ ...DEFAULT_CONFIG, credential: { mode: 'ref', ref } })
    expect(h.ctx.authorization.list()).toEqual([])
    await h.memory.set(ref, SECRET)
    fetchMock.mockImplementation(async () => json(account))
    expect(await h.service.account({}, signal())).toEqual({ state: 'connected', writable: false, account: { id: '42', login: 'octocat', webUrl: account.html_url } })
    await h.memory.set(ref, 'rotated-fixture')
    await h.service.account({}, signal())
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer ' + SECRET)
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('Bearer rotated-fixture')
  })

  it('refuses authorization before prompting when record storage is read-only', async () => {
    const h = await boot()
    h.memory.writable = false
    expect(await h.service.account({}, signal())).toEqual({ state: 'disconnected', writable: false })
    let prompts = 0
    await expect(h.ctx.authorization.begin({ key: GITHUB_CREDENTIAL_KEY, interaction: {
      notify() {}, async prompt() { prompts++; return SECRET },
    } })).rejects.toThrow('GitHub operation failed')
    expect(prompts).toBe(0)
    expect(h.memory.commits).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a delayed committed PAT after cancellation without rollback', async () => {
    const h = await boot()
    const barrier = { entered: gate(), release: gate() }
    h.memory.commitBarrier = barrier
    const attempt = h.ctx.authorization.begin({ key: GITHUB_CREDENTIAL_KEY, interaction: interaction() })
    await barrier.entered.promise
    try {
      h.ctx.authorization.cancel(GITHUB_CREDENTIAL_KEY)
      expect(await attempt).toEqual({ status: 'cancelled' })
      expect(await h.memory.readRecord(GITHUB_CREDENTIAL_KEY)).toBeUndefined()
    } finally { barrier.release.resolve() }
    await h.memory.modifyRecord(GITHUB_CREDENTIAL_KEY, async () => undefined)
    await drainMicrotasks()
    expect(await h.memory.readRecord(GITHUB_CREDENTIAL_KEY)).toEqual({ kind: 'api-key', key: SECRET })
    expect(h.memory.commits).toEqual([GITHUB_CREDENTIAL_KEY])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('human decline writes nothing', async () => {
    const h = await boot()
    const result = await h.ctx.authorization.begin({ key: GITHUB_CREDENTIAL_KEY, interaction: {
      notify() {}, async prompt() { throw new AuthorizationDeclinedError() },
    } })
    expect(result).toEqual({ status: 'cancelled' })
    expect(h.memory.commits).toEqual([])
  })

  it('cancellation while the mutation is queued prevents a later commit', async () => {
    const h = await boot()
    const entered = gate(), release = gate()
    const blocker = h.memory.modifyRecord(GITHUB_CREDENTIAL_KEY, async () => { entered.resolve(); await release.promise; return undefined })
    await entered.promise
    h.memory.queued = gate()
    const attempt = h.ctx.authorization.begin({ key: GITHUB_CREDENTIAL_KEY, interaction: interaction() })
    await h.memory.queued.promise
    h.ctx.authorization.cancel(GITHUB_CREDENTIAL_KEY)
    release.resolve()
    await blocker
    expect(await attempt).toEqual({ status: 'cancelled' })
    expect(h.memory.commits).toEqual([])
    expect(await h.memory.readRecord(GITHUB_CREDENTIAL_KEY)).toBeUndefined()
  })

  it('unloading joins a queued flow and removes its registration before returning', async () => {
    const h = await boot()
    const entered = gate(), release = gate()
    const blocker = h.memory.modifyRecord(GITHUB_CREDENTIAL_KEY, async () => { entered.resolve(); await release.promise; return undefined })
    await entered.promise
    h.memory.queued = gate()
    const attempt = h.ctx.authorization.begin({ key: GITHUB_CREDENTIAL_KEY, interaction: interaction() })
    await h.memory.queued.promise
    let disposed = false
    const disposal = h.fiber.dispose().then(() => { disposed = true })
    try {
      await drainMicrotasks()
      expect(disposed).toBe(false)
    } finally { release.resolve() }
    await blocker
    await disposal
    expect(await attempt).toEqual({ status: 'cancelled' })
    expect(h.ctx.authorization.list()).toEqual([])
    expect(h.memory.commits).toEqual([])
    expect(h.ctx.get('github')).toBeUndefined()
    await expect(h.service.account({}, signal())).rejects.toThrow('GitHub operation failed')
  })
})

describe('GitHub bounded fixed-origin GET operations', () => {
  it('allowlists DTOs and rereads the record for each operation without deleting it on 401', async () => {
    const h = await connected()
    fetchMock.mockResolvedValueOnce(json({ ...account, token: SECRET, email: 'private@example.invalid' }))
    expect(await h.service.account({}, signal())).toEqual({ state: 'connected', writable: true, authFlowKey: GITHUB_CREDENTIAL_KEY,
      account: { id: '42', login: 'octocat', webUrl: account.html_url } })
    await h.memory.modifyRecord(GITHUB_CREDENTIAL_KEY, async () => ({ kind: 'api-key', key: 'rotated-fixture' }))
    fetchMock.mockResolvedValueOnce(new Response(SECRET, { status: 401 }))
    expect(await h.service.account({}, signal())).toEqual({ state: 'disconnected', writable: true, authFlowKey: GITHUB_CREDENTIAL_KEY })
    expect(await h.memory.readRecord(GITHUB_CREDENTIAL_KEY)).toEqual({ kind: 'api-key', key: 'rotated-fixture' })
    fetchMock.mockResolvedValueOnce(json([{ ...repo, token: SECRET, clone_url: 'https://secret.invalid' }]))
    expect(await h.service.repositories({ page: 1 }, signal())).toEqual({ repositories: [{ id: '7', owner: 'octocat', name: 'hello', private: true, defaultBranch: 'main', webUrl: repo.html_url }] })
    for (const [url, init] of fetchMock.mock.calls) {
      expect(requestUrl(url).origin).toBe('https://api.github.com')
      expect(init?.method).toBe('GET')
      expect(init?.redirect).toBe('error')
    }
    expect(requestUrl(fetchMock.mock.calls[0]?.[0]).pathname).toBe('/user')
    expect(requestUrl(fetchMock.mock.calls[2]?.[0]).pathname).toBe('/user/repos')
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('Bearer rotated-fixture')
  })

  it.each([403, 429, 500, 302])('sanitizes external status %i and retains the credential', async (status) => {
    const h = await connected()
    fetchMock.mockResolvedValue(new Response(SECRET, { status, headers: { location: 'https://evil.invalid/' } }))
    await expect(h.service.repositories({ page: 1 }, signal())).rejects.toThrow('GitHub operation failed')
    expect(await h.memory.readRecord(GITHUB_CREDENTIAL_KEY)).toEqual({ kind: 'api-key', key: SECRET })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['fixture"PAT', 'fixture\\PAT'])('rejects JSON-escaped PAT reflection in default_branch %#', async (pat) => {
    const h = await boot()
    await h.memory.modifyRecord(GITHUB_CREDENTIAL_KEY, async () => ({ kind: 'api-key', key: pat }))
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValue(json([{ ...repo, default_branch: pat }]))
    await expect(h.service.repositories({ page: 1 }, signal())).rejects.toThrow('GitHub operation failed')
    expect(await h.memory.readRecord(GITHUB_CREDENTIAL_KEY)).toEqual({ kind: 'api-key', key: pat })
  })

  it('sanitizes credential storage failures without issuing external requests', async () => {
    const h = await boot()
    h.memory.readFailure = new Error(SECRET, { cause: new Error('private storage path') })
    for (const operation of [h.service.account({}, signal()), h.service.repositories({ page: 1 }, signal())]) {
      const error = await operation.catch((error: unknown) => error)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('GitHub operation failed')
      expect((error as Error).cause).toBeUndefined()
      expect(String(error)).not.toContain(SECRET)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a public DTO containing the credential sentinel', async () => {
    const h = await boot()
    await h.memory.modifyRecord(GITHUB_CREDENTIAL_KEY, async () => ({ kind: 'api-key', key: 'octocat' }))
    fetchMock.mockResolvedValue(json(account))
    await expect(h.service.account({}, signal())).rejects.toThrow('GitHub operation failed')
    expect(await h.memory.readRecord(GITHUB_CREDENTIAL_KEY)).toEqual({ kind: 'api-key', key: 'octocat' })
  })

  it('bounds disconnected public results including their metadata', async () => {
    const h = await boot({ ...DEFAULT_CONFIG, maxBytes: 1 })
    await expect(h.service.account({}, signal())).rejects.toThrow('GitHub operation failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts GitHub JSON media type with charset', async () => {
    const h = await connected()
    fetchMock.mockResolvedValue(new Response(JSON.stringify(account), { headers: { 'content-type': 'application/vnd.github+json; charset=utf-8' } }))
    expect((await h.service.account({}, signal())).state).toBe('connected')
  })

  it.each(['-1', 'NaN', '1.5', 'bad-length'])('rejects invalid declared content length %s', async (length) => {
    const h = await connected()
    fetchMock.mockResolvedValue(json(account, { 'content-length': length }))
    await expect(h.service.account({}, signal())).rejects.toThrow('GitHub operation failed')
  })

  it('does not expose fetch exceptions or their causes', async () => {
    const h = await connected()
    fetchMock.mockRejectedValue(new Error(SECRET, { cause: new Error('private-header') }))
    const error = await h.service.account({}, signal()).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('GitHub operation failed')
    expect((error as Error).cause).toBeUndefined()
    expect(String(error)).not.toContain(SECRET)
  })

  it.each([
    new Response('{}', { headers: { 'content-type': 'text/html' } }),
    new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    json({ ...account, id: Number.MAX_SAFE_INTEGER + 1 }),
    json({ ...account, html_url: 'https://evil.invalid/octocat' }),
    json({ ...account, login: SECRET + '\n' }),
  ])('rejects non-JSON, malformed UTF-8, or invalid account fields %#', async (response) => {
    const h = await connected()
    fetchMock.mockResolvedValue(response)
    await expect(h.service.account({}, signal())).rejects.toThrow('GitHub operation failed')
  })

  it('counts streamed bytes, accepts the exact limit, and rejects one extra byte', async () => {
    const projected = { state: 'connected', account: { id: '42', login: 'octocat', webUrl: account.html_url }, writable: true, authFlowKey: GITHUB_CREDENTIAL_KEY }
    const limit = new TextEncoder().encode(JSON.stringify(projected)).length
    const text = JSON.stringify(account).padEnd(limit, ' ')
    const bytes = new TextEncoder().encode(text)
    const h = await connected({ ...recordConfig, maxBytes: limit })
    fetchMock.mockResolvedValueOnce(new Response(bytes, { headers: { 'content-type': 'application/json' } }))
    expect((await h.service.account({}, signal())).state).toBe('connected')
    fetchMock.mockResolvedValueOnce(new Response(text + ' ', { headers: { 'content-type': 'application/json' } }))
    await expect(h.service.account({}, signal())).rejects.toThrow('GitHub operation failed')
  })

  it('rejects oversized declared content and oversized single streamed chunks', async () => {
    const h = await connected({ ...recordConfig, maxBytes: 8 })
    fetchMock.mockResolvedValueOnce(json(account, { 'content-length': '1000000' }))
    await expect(h.service.account({}, signal())).rejects.toThrow('GitHub operation failed')
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(account)))
      controller.close()
    } })
    fetchMock.mockResolvedValueOnce(new Response(stream, { headers: { 'content-type': 'application/json' } }))
    await expect(h.service.account({}, signal())).rejects.toThrow('GitHub operation failed')
  })

  it('rejects extra repositories beyond the configured item count', async () => {
    const h = await connected({ ...recordConfig, maxItems: 1, pageSize: 1 })
    fetchMock.mockResolvedValueOnce(json([repo]))
    expect((await h.service.repositories({ page: 1 }, signal())).repositories).toHaveLength(1)
    fetchMock.mockResolvedValueOnce(json([repo, { ...repo, id: 8 }]))
    await expect(h.service.repositories({ page: 1 }, signal())).rejects.toThrow('GitHub operation failed')
  })

  it.each([0, -1, 1.5, 1001, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid local page %s before fetch', async (page) => {
    const h = await connected()
    await expect(h.service.repositories({ page }, signal())).rejects.toThrow('GitHub operation failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses local page URLs and never follows an external Link header', async () => {
    const h = await connected({ ...recordConfig, pageSize: 1, maxPages: 2 })
    fetchMock.mockResolvedValueOnce(json([repo], { link: '<https://evil.invalid/steal?token=' + SECRET + '>; rel="next"' }))
    const first = await h.service.repositories({ page: 1 }, signal())
    expect(first.nextPage).toBe(2)
    fetchMock.mockResolvedValueOnce(json([repo], { link: '<https://evil.invalid/steal>; rel="next"' }))
    expect((await h.service.repositories({ page: 2 }, signal())).nextPage).toBeUndefined()
    const url = requestUrl(fetchMock.mock.calls[1]?.[0])
    expect(url.origin + url.pathname).toBe('https://api.github.com/user/repos')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('per_page')).toBe('1')
    expect(JSON.stringify(first)).not.toContain(SECRET)
  })

  it('does not let a Link header force continuation on an empty page', async () => {
    const h = await connected()
    fetchMock.mockResolvedValue(json([], { link: '<https://evil.invalid/steal>; rel="next"' }))
    expect(await h.service.repositories({ page: 1 }, signal())).toEqual({ repositories: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not treat an ambient api-key sentinel as a PAT', async () => {
    const h = await boot()
    await h.memory.modifyRecord(GITHUB_CREDENTIAL_KEY, async () => ({ kind: 'api-key' }))
    expect((await h.service.account({}, signal())).state).toBe('disconnected')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an incompatible grant without using its payload as a PAT', async () => {
    const h = await boot()
    await h.memory.modifyRecord(GITHUB_CREDENTIAL_KEY, async () => ({ kind: 'grant', payload: { token: SECRET } }))
    await expect(h.service.account({}, signal())).rejects.toThrow('GitHub operation failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects repository 401 without deleting or rewriting the record', async () => {
    const h = await connected()
    fetchMock.mockResolvedValue(new Response(SECRET, { status: 401 }))
    await expect(h.service.repositories({ page: 1 }, signal())).rejects.toThrow('GitHub operation failed')
    expect(await h.memory.readRecord(GITHUB_CREDENTIAL_KEY)).toEqual({ kind: 'api-key', key: SECRET })
    expect(h.memory.commits).toHaveLength(1)
  })

  it('accepts nullable branches and UTF-8 split across stream chunks', async () => {
    const h = await connected()
    const bytes = new TextEncoder().encode(JSON.stringify([{ ...repo, default_branch: null, description: 'café' }]))
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    } })
    fetchMock.mockResolvedValue(new Response(stream, { headers: { 'content-type': 'application/json' } }))
    const result = await h.service.repositories({ page: 1 }, signal())
    expect(result.repositories[0]?.defaultBranch).toBeNull()
    expect(result.repositories[0]?.name).toBe('hello')
  })

  it.each([{}, { ...repo, private: 'yes' }, { ...repo, owner: null }, { ...repo, default_branch: 3 }, { ...repo, id: -1 }])('rejects invalid external repository fields %#', async (value) => {
    const h = await connected()
    fetchMock.mockResolvedValue(json([value]))
    await expect(h.service.repositories({ page: 1 }, signal())).rejects.toThrow('GitHub operation failed')
  })

  it('rejects an already cancelled caller before issuing a request', async () => {
    const h = await connected()
    const controller = new AbortController()
    controller.abort(new Error(SECRET))
    await expect(h.service.account({}, controller.signal)).rejects.toThrow('GitHub operation failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('times out a stalled response body and joins held async stream cancellation', async () => {
    const h = await connected({ ...recordConfig, timeoutMs: 10 })
    const cancelling = gate(), release = gate()
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      async cancel() { cancelling.resolve(); await release.promise; cancelled = true },
    }, { highWaterMark: 0 })
    fetchMock.mockResolvedValue(new Response(stream, { headers: { 'content-type': 'application/json' } }))
    const operation = h.service.account({}, signal())
    let operationSettled = false
    void operation.then(() => { operationSettled = true }, () => { operationSettled = true })
    const rejection = expect(operation).rejects.toThrow('GitHub operation failed')
    await cancelling.promise
    try {
      await drainMicrotasks()
      expect(operationSettled).toBe(false)
      expect(cancelled).toBe(false)
    } finally { release.resolve() }
    await rejection
    expect(operationSettled).toBe(true)
    expect(cancelled).toBe(true)
  })

  it('times out a stalled external fetch and aborts its signal', async () => {
    const h = await connected({ ...recordConfig, timeoutMs: 10 })
    let aborted = false
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error(SECRET)) }, { once: true })
    }))
    await expect(h.service.account({}, signal())).rejects.toThrow('GitHub operation failed')
    expect(aborted).toBe(true)
  })

  it('joins an aborted response read on unload and removes the authorization flow', async () => {
    const h = await connected()
    const entered = gate(), release = gate(), cancelling = gate()
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull() { entered.resolve() },
      async cancel() { cancelling.resolve(); await release.promise; cancelled = true },
    }, { highWaterMark: 0 })
    fetchMock.mockResolvedValue(new Response(stream, { headers: { 'content-type': 'application/json' } }))
    const operation = h.service.account({}, signal())
    let operationSettled = false
    void operation.then(() => { operationSettled = true }, () => { operationSettled = true })
    const rejection = expect(operation).rejects.toThrow('GitHub operation failed')
    await entered.promise
    let disposed = false
    const disposal = h.fiber.dispose().then(() => { disposed = true })
    await cancelling.promise
    try {
      await drainMicrotasks()
      expect(disposed).toBe(false)
      expect(operationSettled).toBe(false)
    } finally { release.resolve() }
    await disposal
    await rejection
    expect(disposed).toBe(true)
    expect(operationSettled).toBe(true)
    expect(cancelled).toBe(true)
    expect(h.ctx.authorization.list()).toEqual([])
  })
})
