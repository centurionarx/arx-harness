/** Host-only read-only GitHub gateway and private human PAT flow. */
import { Context } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import { AuthorizationDeclinedError } from '@arx-ai/arx-authorization'
import { Remote, TypertRemoteService } from '@arx-ai/arx-typert-protocol'
import { DEFAULT_CONFIG, GITHUB_CREDENTIAL_KEY, resolveConfig } from './config.ts'
import type { Config, GithubAccount, GithubAccountResult, GithubId, GithubRepositoriesRequest, GithubRepositoriesResult, GithubRepository, ServiceConfig } from './types.ts'
export type * from './types.ts'
export { DEFAULT_CONFIG, GITHUB_CREDENTIAL_KEY } from './config.ts'
declare module '@arx-ai/cordis' { interface Context { /** Read-only GitHub host service. */ github: GithubService } }
class Unauthorized extends Error {}
const failed = () => new Error('GitHub operation failed')
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failed()
  return value as Record<string, unknown>
}
function id(value: unknown): GithubId {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw failed()
  return String(value) as GithubId
}
function name(value: unknown, max: number, pattern: RegExp): string {
  if (typeof value !== 'string' || !value.length || value.length > max || !pattern.test(value)) throw failed()
  return value
}
function account(value: unknown): GithubAccount {
  const data = object(value), login = name(data.login, 39, /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/)
  const webUrl = 'https://github.com/' + login
  if (data.html_url !== webUrl) throw failed()
  return { id: id(data.id), login, webUrl }
}
function repository(value: unknown): GithubRepository {
  const data = object(value)
  const owner = name(object(data.owner).login, 39, /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/)
  const repoName = name(data.name, 100, /^[A-Za-z0-9_.-]+$/)
  if (repoName === '.' || repoName === '..' || typeof data.private !== 'boolean') throw failed()
  const defaultBranch = data.default_branch === null ? null : name(data.default_branch, 255, /.+/)
  if (defaultBranch !== null) for (const c of defaultBranch) {
    if (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) throw failed()
  }
  const webUrl = 'https://github.com/' + owner + '/' + repoName
  if (data.html_url !== webUrl) throw failed()
  return { id: id(data.id), owner, name: repoName, private: data.private, defaultBranch, webUrl }
}
/** Fixed-origin reads; all failures exclude external diagnostics and credentials. */
export class GithubService extends TypertRemoteService {
  static inject = ['credentials', 'authorization']
  static Config: z<Config> = z.object({
    credential: z.any().default(DEFAULT_CONFIG.credential),
    maxBytes: z.number().default(DEFAULT_CONFIG.maxBytes), maxItems: z.number().default(DEFAULT_CONFIG.maxItems),
    timeoutMs: z.number().default(DEFAULT_CONFIG.timeoutMs), pageSize: z.number().default(DEFAULT_CONFIG.pageSize),
    maxPages: z.number().default(DEFAULT_CONFIG.maxPages), patBytes: z.number().default(DEFAULT_CONFIG.patBytes),
  })
  private readonly config: ServiceConfig
  private readonly disposal = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  constructor(ctx: Context, input: Config = {}) {
    super(ctx, 'github')
    this.config = resolveConfig(input)
    let removeFlow = () => {}
    ctx.effect(() => async () => {
      removeFlow(); this.disposal.abort()
      await Promise.allSettled(this.pending)
    }, 'github operation quiescence')
    if (this.config.credential.mode === 'record') removeFlow = ctx.authorization.registerFlow({
      key: GITHUB_CREDENTIAL_KEY, label: 'GitHub', methods: [{ id: 'pat', label: 'Personal access token' }],
      run: session => this.operation(session.signal, async (signal) => {
        if (!(await ctx.credentials.describeRecord(GITHUB_CREDENTIAL_KEY)).writable) throw failed()
        signal.throwIfAborted()
        const pat = await session.prompt({ kind: 'secret', message: 'Enter your GitHub personal access token', signal })
        this.validatePat(pat); signal.throwIfAborted()
        await ctx.credentials.modifyRecord(GITHUB_CREDENTIAL_KEY, () => {
          signal.throwIfAborted()
          // Returning the replacement is the commit decision; never roll back a committed record.
          return Promise.resolve({ kind: 'api-key', key: pat })
        })
      }, true),
    })
  }
  /**
   * Read current connection state; 401 never deletes storage.
   * @param request - Empty request, with no credential or URL selector.
   * @param signal - Gateway-owned cancellation.
   * @returns Allowlisted account and private flow availability.
   */
  @Remote
  account(request: Record<string, never>, signal: AbortSignal): Promise<GithubAccountResult> {
    return this.operation(signal, async (owned) => {
      if (Object.keys(object(request)).length) throw failed()
      if (this.config.credential.mode === 'unconfigured') return this.bound({ state: 'unconfigured', writable: false })
      const writable = this.config.credential.mode === 'record' && (await this.ctx.credentials.describeRecord(GITHUB_CREDENTIAL_KEY)).writable
      const availability = writable ? { writable, authFlowKey: GITHUB_CREDENTIAL_KEY } : { writable: false }
      const token = await this.token(); owned.throwIfAborted()
      if (!token) return this.bound({ state: 'disconnected', ...availability })
      try { return this.bound({ state: 'connected', account: account(await this.get('/user', token, owned)), ...availability }, token) }
      catch (error) {
        if (error instanceof Unauthorized) return this.bound({ state: 'disconnected', ...availability }, token)
        throw error
      }
    })
  }
  /**
   * Read one bounded, locally addressed page; all remote failures reject safely.
   * @param request - Integer page within the configured range.
   * @param signal - Gateway-owned cancellation.
   * @returns Allowlisted rows and locally computed continuation.
   */
  @Remote
  repositories(request: GithubRepositoriesRequest, signal: AbortSignal): Promise<GithubRepositoriesResult> {
    return this.operation(signal, async (owned) => {
      if (Object.keys(object(request)).length !== 1 || !Number.isSafeInteger(request.page)
        || request.page < 1 || request.page > this.config.maxPages) throw failed()
      const token = await this.token(); owned.throwIfAborted()
      if (!token) throw failed()
      const query = new URLSearchParams({ per_page: String(this.config.pageSize), page: String(request.page),
        sort: 'full_name', direction: 'asc' })
      const data = await this.get('/user/repos?' + query.toString(), token, owned)
      if (!Array.isArray(data) || data.length > this.config.pageSize || data.length > this.config.maxItems) throw failed()
      const continuation = data.length === this.config.pageSize && request.page < this.config.maxPages
        ? { nextPage: request.page + 1 } : {}
      return this.bound({ repositories: data.map(repository), ...continuation }, token)
    })
  }
  private validatePat(pat: string): void {
    if (typeof pat !== 'string' || !/^[!-~]+$/.test(pat) || Buffer.byteLength(pat) > this.config.patBytes) throw failed()
  }
  private async token(): Promise<string | undefined> {
    let token: string | undefined
    switch (this.config.credential.mode) {
      case 'unconfigured': return undefined
      case 'ref': token = (await this.ctx.credentials.resolve(this.config.credential.ref))?.value; break
      case 'record': {
        const record = await this.ctx.credentials.readRecord(GITHUB_CREDENTIAL_KEY)
        if (record && record.kind !== 'api-key') throw failed()
        token = record?.key; break
      }
    }
    if (token !== undefined) this.validatePat(token)
    return token
  }
  private bound<T>(value: T, token?: string): T {
    const json = JSON.stringify(value)
    if (Buffer.byteLength(json) > this.config.maxBytes || (token && json.includes(JSON.stringify(token).slice(1, -1)))) throw failed()
    return value
  }
  private async get(path: string, token: string, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    const response = await fetch('https://api.github.com' + path, { method: 'GET', redirect: 'error', signal,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
    const reader = response.body?.getReader()
    let cancellation: Promise<void> | undefined
    const cancel = reader === undefined ? undefined : () => {
      cancellation ??= reader.cancel().catch(() => { /* Stream cancellation diagnostics stay private. */ })
    }
    if (cancel) signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      if (response.redirected || (response.url && new URL(response.url).origin !== 'https://api.github.com')) throw failed()
      if (response.status === 401) throw new Unauthorized()
      const media = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
      if (response.status !== 200 || (media !== 'application/json' && media !== 'application/vnd.github+json') || !reader) throw failed()
      const length = response.headers.get('content-length')
      if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > this.config.maxBytes)) throw failed()
      const decoder = new TextDecoder('utf-8', { fatal: true })
      let text = '', bytes = 0
      while (true) {
        const chunk = await reader.read(); signal.throwIfAborted()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > this.config.maxBytes) throw failed()
        text += decoder.decode(chunk.value, { stream: true })
      }
      text += decoder.decode()
      return JSON.parse(text) as unknown
    } finally {
      if (cancel) {
        signal.removeEventListener('abort', cancel)
        cancel()
        await cancellation
      }
      reader?.releaseLock()
    }
  }
  private operation<T>(caller: AbortSignal, run: (signal: AbortSignal) => Promise<T>, commit = false): Promise<T> {
    const timeout = new AbortController(), timer = setTimeout(() =>{  timeout.abort() }, this.config.timeoutMs)
    const signal = AbortSignal.any([caller, this.disposal.signal, timeout.signal])
    const promise = (async () => {
      try {
        signal.throwIfAborted()
        const result = await run(signal)
        if (!commit) signal.throwIfAborted()
        return result
      } catch (error) {
        if (error instanceof AuthorizationDeclinedError) throw new AuthorizationDeclinedError()
        throw failed()
      } finally { clearTimeout(timer) }
    })()
    this.pending.add(promise)
    void promise.then(() => this.pending.delete(promise), () => this.pending.delete(promise))
    return promise
  }
}
export default GithubService
