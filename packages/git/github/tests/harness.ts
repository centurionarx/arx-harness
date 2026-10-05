import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import AuthorizationService from '@arx-ai/arx-authorization'
import { CredentialProvider } from '@arx-ai/arx-credentials'
import type { CredentialKey, CredentialRecord, CredentialRef } from '@arx-ai/arx-credentials'
import GithubService from '../src/index.ts'
import { DEFAULT_CONFIG, GITHUB_CREDENTIAL_KEY } from '../src/config.ts'
import type { ServiceConfig } from '../src/types.ts'

/** Explicit gates for deterministic queue and teardown races. @returns A completion promise and its release function. */
export function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

/** Test-owned credential storage; callbacks run serially and commits emit the real seam event. */
class MemoryCredentials extends CredentialProvider {
  readonly records = new Map<CredentialKey, CredentialRecord>()
  readonly refs = new Map<CredentialRef, string>()
  readonly commits: CredentialKey[] = []
  queued = gate()
  private tail: Promise<unknown> = Promise.resolve()
  writable = true
  readFailure?: Error
  commitBarrier?: { entered: ReturnType<typeof gate>; release: ReturnType<typeof gate> }
  async resolve(ref: CredentialRef) {
    const value = this.refs.get(ref)
    return value ? { value, source: 'memory' } : undefined
  }
  async describe(ref: CredentialRef) {
    return { configured: Boolean(this.refs.get(ref)), writable: this.writable }
  }
  async set(ref: CredentialRef, value: string) {
    if (!this.writable || !value) throw new Error('credential write refused')
    this.refs.set(ref, value)
    this.ctx.emit('credentials/reference-updated', ref)
  }
  async unset(ref: CredentialRef) {
    if (!this.writable) throw new Error('credential write refused')
    if (this.refs.delete(ref)) this.ctx.emit('credentials/reference-updated', ref)
  }
  async readRecord(key: CredentialKey) {
    if (this.readFailure) throw this.readFailure
    return this.records.get(key)
  }
  async describeRecord(key: CredentialKey) {
    const record = this.records.get(key)
    return { configured: record !== undefined, writable: this.writable, ...(record ? { kind: record.kind } : {}) }
  }
  async listRecords() { return [...this.records].map(([key, record]) => ({ key, kind: record.kind })) }
  modifyRecord(key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    this.queued.resolve()
    const operation = this.tail.then(async () => {
      if (!this.writable) throw new Error('credential write refused')
      const current = this.records.get(key)
      const next = await mutate(current)
      if (next === undefined) return current
      if (this.commitBarrier) {
        this.commitBarrier.entered.resolve()
        await this.commitBarrier.release.promise
      }
      this.records.set(key, next)
      this.commits.push(key)
      this.ctx.emit('credentials/record-updated', key)
      return next
    })
    this.tail = operation.catch(() => undefined)
    return operation
  }
  deleteRecord(key: CredentialKey) {
    const operation = this.tail.then(() => {
      if (!this.writable) throw new Error('credential write refused')
      if (this.records.delete(key)) this.ctx.emit('credentials/record-updated', key)
    })
    this.tail = operation.catch(() => undefined)
    return operation
  }
}

/** Record-mode configuration with the approved package defaults. */
export const recordConfig: ServiceConfig = { ...DEFAULT_CONFIG, credential: { mode: 'record', key: GITHUB_CREDENTIAL_KEY } }

/**
 * Boot real providers through a temporary cordis.yml; no ambient credential provider is mounted.
 * @param config - Complete operator configuration.
 * @returns Loaded services, the GitHub fiber, and an async resource disposer.
 */
export async function harness(config: ServiceConfig = recordConfig) {
  const root = await mkdtemp(join(tmpdir(), 'arx-github-'))
  const ctx = new Context()
  const close = async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  try {
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([{ name: 'memory' }, { name: 'authorization' }, { name: 'github', config }]))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([['memory', MemoryCredentials], ['authorization', AuthorizationService], ['github', GithubService]])
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected plugin import')
      return modules.get(specifier)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const service = ctx.get('github')
    if (!service) throw new Error('GitHub service did not load')
    const entry = [...ctx.loader.entries()].find(item => item.options.name === 'github')
    if (!entry?.fiber) throw new Error('GitHub Loader fiber missing')
    return { ctx, service, memory: ctx.credentials as MemoryCredentials, fiber: entry.fiber, close }
  } catch (error) {
    await close()
    throw error
  }
}
