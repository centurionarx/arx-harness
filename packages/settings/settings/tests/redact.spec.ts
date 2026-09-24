import { describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import { redactSecrets, settingsNamespace } from '../src/index.ts'
import { MemorySettings } from './memory.ts'
import { redactSchema } from '../src/redact.ts'

const Profile = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref'),
  baseURL: z.string(),
})

const Adapter: z<object> = z.object({
  apiKey: z.string().role('secret'),
  providers: z.dict(Profile),
  fallbacks: z.array(Profile),
  nested: z.object({
    token: z.string().role('secret'),
  }),
})

describe('redactSecrets', () => {
  it('strips secrets from object, dict, and array containers and records each position', () => {
    const { value, secrets } = redactSecrets(Adapter as z<never>, {
      apiKey: 'top-secret',
      providers: {
        openai: { apiKey: 'sk-live', apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://x' },
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      },
      fallbacks: [{ apiKey: 'fb', baseURL: 'https://y' }],
      nested: {},
    })
    expect(value).toEqual({
      providers: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://x' },
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      },
      fallbacks: [{ baseURL: 'https://y' }],
      nested: {},
    })
    expect(secrets).toEqual([
      { path: ['apiKey'], set: true },
      { path: ['providers', 'openai', 'apiKey'], set: true },
      { path: ['providers', 'anthropic', 'apiKey'], set: false },
      { path: ['fallbacks', '0', 'apiKey'], set: true },
      { path: ['nested', 'token'], set: false },
    ])
  })

  it('enumerates unset object-property slots without inventing containers', () => {
    const { value, secrets } = redactSecrets(Adapter as z<never>, undefined)
    expect(value).toBeUndefined()
    expect(secrets).toEqual([
      { path: ['apiKey'], set: false },
      { path: ['nested', 'token'], set: false },
    ])
  })

  it('never mutates the input and drops keys outside the schema', () => {
    const input = Object.freeze({
      apiKey: 'frozen',
      extra: Object.freeze({ keep: true }),
    })
    const { value } = redactSecrets(Adapter as z<never>, input)
    expect(input.apiKey).toBe('frozen')
    expect(value).toEqual({})
    expect(input.extra).toEqual({ keep: true })
  })

  it.each(['providers', 'fallbacks', 'nested'])('rejects malformed %s values without echoing them', (key) => {
    expect(() => redactSecrets(Adapter as z<never>, { [key]: 'fixture-private-value' }))
      .toThrow('settings value cannot be safely redacted')
  })

  it('treats a secret-role container as one opaque secret leaf', () => {
    const Weird = z.object({ blob: z.object({ inner: z.string() }).role('secret') })
    const { value, secrets } = redactSecrets(Weird as z<never>, { blob: { inner: 'x' } })
    expect(value).toEqual({})
    expect(secrets).toEqual([{ path: ['blob'], set: true }])
  })

  it('drops a dict entry whose entire value is the secret', () => {
    const Tokens = z.object({ tokens: z.dict(z.string().role('secret')) })
    const { value, secrets } = redactSecrets(Tokens as z<never>, { tokens: { a: 'x', b: 'y' } })
    expect(value).toEqual({ tokens: {} })
    expect(secrets).toEqual([
      { path: ['tokens', 'a'], set: true },
      { path: ['tokens', 'b'], set: true },
    ])
  })

  it.each(['dict', 'object', 'array'])('rejects incomplete %s schema nodes', (type) => {
    expect(() => redactSecrets(z({ type }), undefined)).toThrow('settings schema cannot be safely redacted')
  })
})

describe('composite schemas and schema envelopes', () => {
  const fake = 'fixture-private-value'
  const secret = z.string().role('secret').default(fake)

  it.each([
    ['secret primitive union', z.union([z.string(), secret])],
    ['secret object union', z.union([z.object({ mode: z.const('local'), token: secret }), z.object({ mode: z.const('public') })])],
    ['intersection', z.intersect([z.object({ token: secret }), z.object({ enabled: z.boolean() })])],
    ['transform', z.transform(z.object({ token: secret }), value => ({ alias: value.token }))],
    ['unconstrained', z.any()],
    ['object constant', z.const({ token: fake })],
    ['empty union', z.union([])],
    ['custom extension', z({ type: 'fixture-extension' })],
    ['secret dictionary key', z.dict(z.string(), z.string().role('secret'))],
  ])('refuses %s even under absent or empty containers', (_label, node) => {
    for (const schema of [node, z.object({ nested: node }), z.array(node), z.dict(node)]) {
      for (const value of [undefined, {}, []]) {
        expect(() => redactSecrets(schema as z<never>, value)).toThrow('settings schema cannot be safely redacted')
        expect(() => redactSchema(schema as z<never>)).toThrow('settings schema cannot be safely redacted')
      }
    }
  })

  it('never executes transforms or lazy builders while proving a schema safe', () => {
    const callback = vi.fn(() => fake)
    const builder = vi.fn(() => z.object({ token: secret }))
    for (const node of [z.transform(z.string(), callback), z.lazy(builder)]) {
      expect(() => redactSecrets(node as z<never>, undefined)).toThrow('cannot be safely redacted')
      expect(() => redactSchema(node as z<never>)).toThrow('cannot be safely redacted')
    }
    expect(callback).not.toHaveBeenCalled()
    expect(builder).not.toHaveBeenCalled()
  })

  it('refuses recursive schemas but accepts shared references', () => {
    const recursive = z.object({})
    recursive.set('next', recursive)
    expect(() => redactSecrets(recursive as z<never>, undefined)).toThrow('cannot be safely redacted')
    expect(() => redactSchema(recursive as z<never>)).toThrow('cannot be safely redacted')
    const shared = z.object({ left: Profile, right: Profile })
    const restored = z(JSON.parse(JSON.stringify(shared)) as z<never>)
    expect(redactSecrets(restored, { left: { apiKey: fake }, right: { baseURL: 'https://example.test' } }).value)
      .toEqual({ left: {}, right: { baseURL: 'https://example.test' } })
  })

  it('accepts a secret role on otherwise unsupported subtrees without serializing their code or constants', () => {
    const callback = vi.fn(() => fake)
    const schema = z.object({
      opaque: z.transform(z.string(), callback).role('secret').default(fake),
      constant: z.const(fake).role('secret'),
      items: z.array(z.any().role('secret')),
    })
    const projected = redactSecrets(schema as z<never>, { opaque: fake, constant: fake, items: [fake, undefined] })
    expect(projected.value).toEqual({ items: [undefined, undefined] })
    expect(projected.secrets).toEqual([
      { path: ['opaque'], set: true }, { path: ['constant'], set: true },
      { path: ['items', '0'], set: true }, { path: ['items', '1'], set: false },
    ])
    const envelope = JSON.stringify(redactSchema(schema as z<never>))
    expect(envelope).not.toContain(fake)
    expect(envelope).not.toContain('callback')
    expect(envelope).not.toContain('transform')
    expect(callback).not.toHaveBeenCalled()
  })

  it('sanitizes defaults on roots, containers and shared leaf references without mutating the schema', () => {
    const profile = z.object({ token: secret, visible: z.string().default('public') })
    const schema = z.object({
      first: profile.default({ token: fake, visible: 'one' }),
      second: profile,
      profiles: z.dict(profile).default({ named: { token: fake, visible: 'two' } }),
      list: z.array(profile).default([{ token: fake, visible: 'three' }]),
    }).default({ first: { token: fake, visible: 'root' }, second: { token: fake, visible: 'shared' }, profiles: {}, list: [] })
    const before = JSON.stringify(schema)
    const envelope = redactSchema(schema as z<never>)
    expect(JSON.stringify(envelope)).not.toContain(fake)
    const restored = z(envelope as z<never>)
    expect(restored()).toEqual({
      first: { visible: 'root' }, second: { visible: 'shared' }, profiles: {}, list: [],
    })
    expect(JSON.stringify(schema)).toBe(before)
  })

  it('keeps safe union defaults and detached structured alternatives', () => {
    const schema = z.union([z.const(false), z.dict(z.union([z.string(), z.const(null)]))])
    const value = { off: null, high: 'high' }
    const redacted = redactSecrets(schema as z<never>, value)
    expect(redacted.value).toEqual(value)
    expect(redacted.value).not.toBe(value)
    expect(redacted.secrets).toEqual([])
    expect(z(redactSchema(schema.default(false) as z<never>) as z<never>)()).toBe(false)
  })

  it('rejects invalid scalar data and cyclic entries with value-free errors', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    for (const [schema, value] of [
      [z.string(), cyclic], [z.number(), Infinity], [z.boolean(), fake],
      [z.never(), fake], [z.union(['one', 'two']), fake],
      [z.dict(z.dict(z.string())), cyclic], [z.object({}), new Date()],
    ] as const) {
      expect(() => redactSecrets(schema as z<never>, value)).toThrow('settings value cannot be safely redacted')
    }
    expect(redactSecrets(z.never(), null).value).toBeNull()
  })

  it('rejects executable or recursive metadata without serializing it', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    for (const extra of [() => fake, cyclic, new Map([['token', fake]]), BigInt(1), [undefined]]) {
      const schema = z.string().role('fixture', extra)
      expect(() => redactSchema(schema as z<never>)).toThrow('settings schema cannot be safely redacted')
    }
    const schema = z.string().role('fixture', { values: ['public', 1, true, null], absent: undefined })
    expect(JSON.stringify(redactSchema(schema as z<never>))).toContain('public')
  })

  it('rechecks mutated schemas on every redaction call', () => {
    const schema = z.object({ visible: z.string() })
    expect(redactSecrets(schema as z<never>, { visible: 'public' }).value).toEqual({ visible: 'public' })
    schema.set('dynamic', z.any())
    expect(() => redactSecrets(schema as z<never>, {})).toThrow('cannot be safely redacted')
    expect(() => redactSchema(schema as z<never>)).toThrow('cannot be safely redacted')
  })

  it('preserves declared prototype-like keys as own data and detaches shared input objects', () => {
    const schema = z.dict(z.object({ visible: z.string(), token: secret }))
    const shared = { visible: 'public', token: fake }
    const input = Object.fromEntries([['__proto__', shared], ['constructor', shared]])
    const result = redactSecrets(schema as z<never>, input).value as Record<string, unknown>
    expect(Object.keys(result)).toEqual(['__proto__', 'constructor'])
    expect(result['__proto__']).toEqual({ visible: 'public' })
    expect(result['__proto__']).not.toBe(result['constructor'])
    expect(input['__proto__']).toBe(shared)
  })
})

describe('describe() layers and redaction', () => {
  const NS = settingsNamespace('adapter')

  async function boot(doc?: Record<string, unknown>) {
    const ctx = new Context()
    await ctx.plugin(MemorySettings, doc === undefined ? undefined : { doc })
    return ctx
  }

  it('exposes detached base and user layers beside the resolved value', async () => {
    const ctx = await boot({ adapter: { baseURL: 'https://user' } })
    const base = { apiKey: 'entry-key', baseURL: 'https://base' }
    ctx.settings.register(NS, Profile, { base })
    const [descriptor] = ctx.settings.describe()
    expect(descriptor?.base).toEqual(base)
    expect(descriptor?.base).not.toBe(base)
    expect(descriptor?.user).toEqual({ baseURL: 'https://user' })
    expect(descriptor?.value).toEqual({ apiKey: 'entry-key', baseURL: 'https://user' })
    ;(descriptor?.user as Record<string, unknown>).baseURL = 'mutated'
    expect(ctx.settings.describe()[0]?.user).toEqual({ baseURL: 'https://user' })
    expect(descriptor?.secrets).toBeUndefined()
  })

  it('omits the layers when neither a base nor a user section exists', async () => {
    const ctx = await boot()
    ctx.settings.register(NS, Profile)
    const [descriptor] = ctx.settings.describe()
    expect(descriptor).not.toHaveProperty('base')
    expect(descriptor).not.toHaveProperty('user')
  })

  it('describes a section that became malformed after registration as having no user layer', async () => {
    const ctx = await boot({ adapter: { baseURL: 'https://user' } })
    const provider = ctx.get('settings') as MemorySettings
    ctx.settings.register(NS, Profile, { base: { baseURL: 'https://base' } })
    provider.pushExternal({ adapter: 5 })
    const [descriptor] = ctx.settings.describe()
    expect(descriptor).not.toHaveProperty('user')
    // The malformed publish kept the last good resolved value.
    expect(descriptor?.value).toEqual({ baseURL: 'https://user' })
  })

  it('redacts a descriptor that has neither base nor user layer', async () => {
    const ctx = await boot()
    ctx.settings.register(NS, Profile)
    const [descriptor] = ctx.settings.describe({ redactSecrets: true })
    expect(descriptor).not.toHaveProperty('base')
    expect(descriptor).not.toHaveProperty('user')
    expect(descriptor?.secrets).toEqual([{ path: ['apiKey'], set: false }])
  })

  it('redacts opaque non-cloneable values before copying layers and never invokes schema serialization', async () => {
    const ctx = await boot()
    const callback = vi.fn(() => 'fixture-private-value')
    const schema = z.object({ opaque: z.function().role('secret'), visible: z.string() })
    ctx.settings.register(NS, schema, { base: { opaque: callback, visible: 'public' } })
    const toJSON = vi.spyOn(schema, 'toJSON').mockImplementation(() => { throw new Error('fixture-private-value') })
    const descriptor = ctx.settings.describe({ redactSecrets: true })[0]
    expect(descriptor?.value).toEqual({ visible: 'public' })
    expect(descriptor?.base).toEqual({ visible: 'public' })
    expect(descriptor?.secrets).toEqual([{ path: ['opaque'], set: true }])
    expect(JSON.stringify(descriptor)).not.toContain('fixture-private-value')
    expect(callback).not.toHaveBeenCalled()
    expect(toJSON).not.toHaveBeenCalled()
  })

  it('withholds validation and observer error contents from provider diagnostics', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(MemorySettings)
    await fiber
    const provider = ctx.get('settings') as MemorySettings
    const warn = vi.spyOn(fiber.ctx.logger, 'warn').mockImplementation(() => {})
    const fake = 'fixture-private-value'
    const scope = ctx.settings.register(NS, z.object({ count: z.number() }))
    provider.pushExternal({ adapter: { count: fake } })
    scope.watch(() => { throw new Error(fake) })
    ctx.on('settings/updated', () => { throw new Error(fake) })
    await scope.update({ count: 1 })
    await fiber.dispose()
    expect(warn).toHaveBeenCalledTimes(3)
    expect(warn.mock.calls.flat().map(String).join(' ')).not.toContain(fake)
    warn.mockRestore()
  })

  it('redacts every layer and enumerates secret slots under redactSecrets', async () => {
    const ctx = await boot({ adapter: { apiKey: 'user-key', baseURL: 'https://user' } })
    ctx.settings.register(NS, Profile, { base: { apiKey: 'entry-key' } })
    const [descriptor] = ctx.settings.describe({ redactSecrets: true })
    expect(descriptor?.value).toEqual({ baseURL: 'https://user' })
    expect(descriptor?.base).toEqual({})
    expect(descriptor?.user).toEqual({ baseURL: 'https://user' })
    expect(descriptor?.secrets).toEqual([{ path: ['apiKey'], set: true }])
    const [verbatim] = ctx.settings.describe()
    expect(verbatim?.value).toEqual({ apiKey: 'user-key', baseURL: 'https://user' })
  })
})
