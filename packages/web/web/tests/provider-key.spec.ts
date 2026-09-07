/** The one key-resolution policy search providers bind to. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import { CredentialProvider, credentialRef } from '@arx-ai/arx-credentials'
import type {
  CredentialInfo, CredentialKey, CredentialRecord, CredentialRecordEntry, CredentialRecordInfo, CredentialRef,
  ResolvedCredential,
} from '@arx-ai/arx-credentials'
import { providerKeySource } from '@arx-ai/arx-web'

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
    return Promise.resolve({ configured: this.store.has(ref), writable: true })
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

const ENV = 'PROBE_API_KEY'
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
const original = process.env[ENV]

afterEach(() => {
  if (original === undefined) Reflect.deleteProperty(process.env, ENV)
  else process.env[ENV] = original
})

async function bench(seed: Record<string, string> | false = {}): Promise<{ ctx: Context; credentials: MemoryCredentials | undefined }> {
  const ctx = new Context()
  if (seed === false) return { ctx, credentials: undefined }
  await ctx.plugin(MemoryCredentials).await()
  const credentials = ctx.get('credentials') as MemoryCredentials
  for (const [ref, value] of Object.entries(seed)) credentials.store.set(ref, value)
  return { ctx, credentials }
}

describe('providerKeySource', () => {
  it('prefers the inlined key, then the store, then the launch environment', async () => {
    process.env[ENV] = 'from-env'
    const { ctx } = await bench({ [ENV]: 'from-store' })
    let inline: string | undefined = 'inline'
    const key = providerKeySource(ctx, { plugin: 'probe', inline: () => inline, ref: () => ENV })
    await settle()
    expect(key.current()).toBe('inline')
    inline = undefined
    expect(key.current()).toBe('from-store')
  })

  it('answers from the environment without a credentials service, and with an empty store', async () => {
    process.env[ENV] = 'from-env'
    const bare = await bench(false)
    expect(providerKeySource(bare.ctx, { plugin: 'probe', inline: () => undefined, ref: () => ENV }).current()).toBe('from-env')
    const empty = await bench({})
    const key = providerKeySource(empty.ctx, { plugin: 'probe', inline: () => undefined, ref: () => ENV })
    await settle()
    expect(key.current()).toBe('from-env')
    Reflect.deleteProperty(process.env, ENV)
    expect(key.current()).toBe('')
  })

  it('follows a credential written or removed under its reference, and only that reference', async () => {
    Reflect.deleteProperty(process.env, ENV)
    const { ctx, credentials } = await bench({})
    const key = providerKeySource(ctx, { plugin: 'probe', inline: () => undefined, ref: () => ENV })
    await settle()
    expect(key.current()).toBe('')
    await credentials!.set(credentialRef(ENV), 'later')
    await settle()
    expect(key.current()).toBe('later')
    const asked = credentials!.resolves
    await credentials!.set(credentialRef('OTHER_KEY'), 'x')
    await settle()
    expect(credentials!.resolves).toBe(asked)
    await credentials!.unset(credentialRef(ENV))
    await settle()
    expect(key.current()).toBe('')
  })

  it('re-reads the store under the reference a refresh names', async () => {
    const { ctx } = await bench({ ALT_KEY: 'alt' })
    let ref = ENV
    const key = providerKeySource(ctx, { plugin: 'probe', inline: () => undefined, ref: () => ref })
    await settle()
    expect(key.current()).toBe('')
    ref = 'ALT_KEY'
    key.refresh()
    await settle()
    expect(key.current()).toBe('alt')
  })

  it('never asks the store about a reference outside its grammar', async () => {
    const { ctx, credentials } = await bench({ [ENV]: 'x' })
    const key = providerKeySource(ctx, { plugin: 'probe', inline: () => undefined, ref: () => 'not a reference' })
    await settle()
    expect(credentials!.resolves).toBe(0)
    expect(key.current()).toBe('')
  })

  it('warns and lets the environment answer while the store fails', async () => {
    process.env[ENV] = 'from-env'
    const { ctx, credentials } = await bench({})
    credentials!.failWith = new Error('store offline')
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const key = providerKeySource(ctx, { plugin: 'probe', inline: () => undefined, ref: () => ENV })
    await settle()
    expect(warn).toHaveBeenCalledWith(`probe: resolving credential "${ENV}" failed; the launch environment answers until it succeeds`)
    expect(key.current()).toBe('from-env')
  })

  it('stops listening when the plugin context is disposed', async () => {
    Reflect.deleteProperty(process.env, ENV)
    const { ctx, credentials } = await bench({})
    const fiber = await ctx.plugin((inner: Context) => {
      providerKeySource(inner, { plugin: 'probe', inline: () => undefined, ref: () => ENV })
    })
    await settle()
    const asked = credentials!.resolves
    await fiber.dispose()
    await credentials!.set(credentialRef(ENV), 'late')
    await settle()
    expect(credentials!.resolves).toBe(asked)
  })
})
