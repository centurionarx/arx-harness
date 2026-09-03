/** The `web-search-exa` settings section, the credential seam, and the directory entry. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import type { Fiber } from '@arx-ai/cordis'
import WebRuntime from '@arx-ai/arx-web'
import { CredentialProvider, credentialRef } from '@arx-ai/arx-credentials'
import type {
  CredentialInfo, CredentialKey, CredentialRecord, CredentialRecordEntry, CredentialRecordInfo, CredentialRef,
  ResolvedCredential,
} from '@arx-ai/arx-credentials'
import { SettingsProvider, settingsNamespace } from '@arx-ai/arx-settings'
import type { SettingsNamespace } from '@arx-ai/arx-settings'
import * as plugin from '@arx-ai/arx-web-search-exa'

const NS = settingsNamespace('web-search-exa')
const ENV = 'EXA_API_KEY'
const KEY = credentialRef(ENV)

/** The smallest real settings provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** One in-memory reference store; `resolves` counts reads so a test can prove the seam was or was not asked. */
class MemoryCredentials extends CredentialProvider {
  readonly store = new Map<string, string>()
  resolves = 0
  failWith: Error | undefined

  override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    this.resolves += 1
    if (this.failWith !== undefined) return Promise.reject(this.failWith)
    const value = this.store.get(ref)
    return Promise.resolve(value === undefined ? undefined : { value, source: 'memory' })
  }

  override describe(ref: CredentialRef): Promise<CredentialInfo> {
    const configured = this.store.has(ref)
    return Promise.resolve({ configured, ...configured ? { source: 'memory' } : {}, writable: true })
  }

  override set(ref: CredentialRef, value: string): Promise<void> {
    this.store.set(ref, value)
    this.notifyUpdated(ref)
    return Promise.resolve()
  }

  override unset(ref: CredentialRef): Promise<void> {
    if (this.store.delete(ref)) this.notifyUpdated(ref)
    return Promise.resolve()
  }

  override readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
    return Promise.resolve(undefined)
  }

  override describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
    return Promise.resolve({ configured: false, writable: true })
  }

  override listRecords(): Promise<readonly CredentialRecordEntry[]> {
    return Promise.resolve([])
  }

  override modifyRecord(
    _key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return mutate(undefined)
  }

  override deleteRecord(_key: CredentialKey): Promise<void> {
    return Promise.resolve()
  }
}

interface Call {
  url: string
  authorization: string
}

/** Capture the one request a search makes; the reply is an empty, well-formed listing. */
function captureSearches(): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, authorization: headers.get('authorization') ?? '' })
    return Promise.resolve(new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
  })
  return calls
}

/** The store answers on a later tick; the plugin caches it then. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

interface Bench {
  ctx: Context
  web: WebRuntime
  credentials: MemoryCredentials | undefined
  fiber: Fiber
}

async function boot(
  config: Parameters<typeof plugin.apply>[1] = {},
  opts: { credentials?: false | Record<string, string>; settings?: boolean } = {},
): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime)
  let credentials: MemoryCredentials | undefined
  if (opts.credentials !== false) {
    await ctx.plugin(MemoryCredentials).await()
    credentials = ctx.get('credentials') as MemoryCredentials
    for (const [ref, value] of Object.entries(opts.credentials ?? {})) credentials.store.set(ref, value)
  }
  if (opts.settings === true) await ctx.plugin(MemorySettings).await()
  const fiber = ctx.plugin(plugin, config)
  await fiber.await()
  await settle()
  return { ctx, web: ctx.web, credentials, fiber }
}

const available = (bench: Bench): boolean => bench.web.listSearchProviders()[0]!.available

const originalEnv = process.env[ENV]

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalEnv === undefined) Reflect.deleteProperty(process.env, ENV)
  else process.env[ENV] = originalEnv
})

describe('web-search-exa settings section', () => {
  it('declares the provider in the directory and withdraws everything with its fiber', async () => {
    Reflect.deleteProperty(process.env, ENV)
    const bench = await boot()
    expect(bench.web.listConfigurableSearchProviders()).toEqual([
      { provider: 'exa', displayName: 'Exa', settingsNs: 'web-search-exa', settingsPath: [] },
    ])
    expect(bench.web.listSearchProviders()).toEqual([{ id: 'exa', available: false }])
    await bench.fiber.dispose()
    expect(bench.web.listConfigurableSearchProviders()).toEqual([])
    expect(bench.web.listSearchProviders()).toEqual([])
  })

  it('resolves the key through the managed store ahead of the launch environment', async () => {
    process.env[ENV] = 'from-env'
    const bench = await boot({}, { credentials: { [ENV]: 'from-store' } })
    const calls = captureSearches()
    await bench.web.search({ query: 'q' })
    expect(calls[0]).toEqual({ url: 'https://api.exa.ai/search', authorization: 'Bearer from-store' })
  })

  it('lets a key inlined in the composition win over every other source', async () => {
    process.env[ENV] = 'from-env'
    const bench = await boot({ apiKey: 'inline' }, { credentials: { [ENV]: 'from-store' } })
    const calls = captureSearches()
    await bench.web.search({ query: 'q' })
    expect(calls[0]!.authorization).toBe('Bearer inline')
  })

  it('falls back to the launch environment without a credentials service or a stored value', async () => {
    process.env[ENV] = 'from-env'
    const bare = await boot({}, { credentials: false })
    const calls = captureSearches()
    await bare.web.search({ query: 'q' })
    expect(calls[0]!.authorization).toBe('Bearer from-env')

    const empty = await boot({}, { credentials: {} })
    await empty.web.search({ query: 'q' })
    expect(calls[1]!.authorization).toBe('Bearer from-env')
  })

  it('follows a credential written or removed under its reference, and only that reference', async () => {
    Reflect.deleteProperty(process.env, ENV)
    const bench = await boot({}, { credentials: {} })
    expect(available(bench)).toBe(false)

    await bench.credentials!.set(KEY, 'later')
    await settle()
    expect(available(bench)).toBe(true)

    const asked = bench.credentials!.resolves
    await bench.credentials!.set(credentialRef('SOME_OTHER_KEY'), 'x')
    await settle()
    expect(bench.credentials!.resolves).toBe(asked)

    await bench.credentials!.unset(KEY)
    await settle()
    expect(available(bench)).toBe(false)
  })

  it('puts a committed section change in force at the next search without re-registering', async () => {
    const bench = await boot({}, { credentials: { [ENV]: 'k' }, settings: true })
    let updates = 0
    bench.ctx.on('web/providers-updated', () => { updates += 1 })
    await bench.ctx.settings.update(NS, { baseURL: 'https://exa.test' })
    await settle()
    const calls = captureSearches()
    await bench.web.search({ query: 'q' })
    expect(calls[0]!.url).toBe('https://exa.test/search')
    expect(updates).toBe(0)
  })

  it('re-reads the store under a reference the section switches to', async () => {
    Reflect.deleteProperty(process.env, ENV)
    const bench = await boot({}, { credentials: { ALT_KEY: 'alt' }, settings: true })
    expect(available(bench)).toBe(false)
    await bench.ctx.settings.update(NS, { apiKeyEnv: 'ALT_KEY' })
    await settle()
    const calls = captureSearches()
    await bench.web.search({ query: 'q' })
    expect(calls[0]!.authorization).toBe('Bearer alt')
  })

  it('never asks the store about a reference outside its grammar', async () => {
    Reflect.deleteProperty(process.env, ENV)
    const bench = await boot({ apiKeyEnv: 'not a reference' }, { credentials: { [ENV]: 'x' } })
    expect(bench.credentials!.resolves).toBe(0)
    expect(available(bench)).toBe(false)
  })

  it('warns and lets the launch environment answer while the store fails', async () => {
    process.env[ENV] = 'from-env'
    const ctx = new Context()
    await ctx.plugin(WebRuntime)
    await ctx.plugin(MemoryCredentials).await()
    ;(ctx.get('credentials') as MemoryCredentials).failWith = new Error('store offline')
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await ctx.plugin(plugin, {}).await()
    await settle()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`resolving credential "${ENV}" failed`))
    const calls = captureSearches()
    await ctx.web.search({ query: 'q' })
    expect(calls[0]!.authorization).toBe('Bearer from-env')
  })
})
