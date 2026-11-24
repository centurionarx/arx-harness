import { execFileSync } from 'node:child_process'
import { writeFile, chmod, symlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Adapter from '../src/index.ts'
import { identityHarness } from '../../../../examples/web-identity/tests/harness.ts'
import { ResendIdentityDelivery } from '../src/index.ts'
let fixture: Awaited<ReturnType<typeof identityHarness>> | undefined
afterEach(async () => { vi.unstubAllGlobals(); await fixture?.close(); fixture = undefined })
const mail = { operationId: 'fixture-operation', to: 'user@fixture.test', purpose: 'reset' as const,
  link: 'https://user.fixture.test/reset#reset=fixture-token', expiresAt: Date.now() + 10000 }
describe('Resend delivery boundary without real email', () => {
  it('uses a fixed endpoint, recipient, idempotency key and safe accepted acknowledgement', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'fixture-provider-id' }), { status: 200 }))
    const sender = new ResendIdentityDelivery('re_fixture00000000', 'sender@fixture.test', fetcher)
    expect(await sender.send(mail, new AbortController().signal)).toEqual({ providerId: 'fixture-provider-id' })
    const [url, init] = fetcher.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('arx-identity-fixture-operation')
    expect(JSON.parse(init.body as string)).toMatchObject({ to: ['user@fixture.test'] })
  })
  it('keeps rejected, malformed and expired deliveries pending for bounded retries', async () => {
    for (const response of [new Response('fixture-sensitive-provider-error', { status: 400 }), new Response('{}', { status: 200 }), new Response(JSON.stringify({ id: '' }), { status: 200 }), new Response(JSON.stringify({ id: 'x'.repeat(129) }), { status: 200 })]) {
      const sender = new ResendIdentityDelivery('re_fixture00000000', 'sender@fixture.test', vi.fn(async () => response))
      await expect(sender.send(mail, new AbortController().signal)).rejects.toMatchObject({ code: 'AUTH_DELIVERY' })
    }
    const fetcher = vi.fn()
    const sender = new ResendIdentityDelivery('re_fixture00000000', 'sender@fixture.test', fetcher)
    await expect(sender.send({ ...mail, expiresAt: 0 }, new AbortController().signal)).rejects.toMatchObject({ code: 'AUTH_DELIVERY' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('loads the delivery consumer through real Cordis using only synthetic private key material', { timeout: 30000 }, async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'fixture-delivery-id' }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    fixture = await identityHarness({ delivery: false })
    const { ctx, paths, master } = fixture, key = join(paths.keyRoot, 'resend-fixture.key')
    await writeFile(key, 're_fixture00000000000000', { mode: 0o600 })
    await ctx.plugin(Adapter, { keyFile: key, from: 'sender@fixture.test' })
    await ctx.webIdentity.createUser(master!, { username: 'resend-invited', email: 'recipient@fixture.test' })
    await ctx.webIdentity.flushOutbox()
    expect(fetcher).toHaveBeenCalledOnce()
    const body = JSON.parse((fetcher.mock.calls[0]! as unknown as [
      unknown,
      RequestInit,
    ])[1].body as string) as {
      subject: string
      text: string
      to: string[]
    }
    expect(body.subject).toContain('Defina sua senha')
    expect(body.text).toContain('#invite=')
    expect(body.to).toEqual(['recipient@fixture.test'])
  })
  it('rejects ambient keys, public permissions, symlinks and malformed private configuration', { timeout: 30000 }, async () => {
    fixture = await identityHarness({ delivery: false })
    const { ctx, paths } = fixture, key = join(paths.keyRoot, 'resend-test.key')
    await writeFile(key, 'invalid', { mode: 0o600 })
    for (const config of [{ keyFile: 'relative.key', from: 'sender@fixture.test' }, { keyFile: join(paths.keyRoot, '.env'), from: 'sender@fixture.test' },
      { keyFile: key, from: 'sender@fixture.test\r\ninjected' }, { keyFile: key, from: 'invalid-sender' }, { keyFile: key, from: 'sender@fixture.test' }])
      await expect(Adapter.apply(ctx, config)).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    await chmod(key, 0o644)
    await expect(Adapter.apply(ctx, { keyFile: key, from: 'sender@fixture.test' })).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    await chmod(key, 0o600)
    if (process.platform === 'win32') {
      const open = join(paths.keyRoot, 'resend-acl.key')
      await writeFile(open, 're_' + 'a'.repeat(16), { mode: 0o600 })
      execFileSync('icacls', [open, '/grant', '*S-1-1-0:(R)'])
      await expect(Adapter.apply(ctx, { keyFile: open, from: 'sender@fixture.test' })).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION', cause: { message: expect.stringContaining('S-1-1-0') as string } })
      execFileSync('icacls', [open, '/remove:g', '*S-1-1-0'])
    }
    const directory = join(paths.keyRoot, 'directory')
    await mkdir(directory, { mode: 0o700 })
    await expect(Adapter.apply(ctx, { keyFile: directory, from: 'sender@fixture.test' })).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
    const linked = join(paths.keyRoot, 'linked')
    await symlink(key, linked)
    await expect(Adapter.apply(ctx, { keyFile: linked, from: 'sender@fixture.test' })).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION' })
  })
})
