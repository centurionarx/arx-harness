/** The account service through a real Cordis root; only the native product processes are substituted. */
import { Context } from '@arx-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'
import NativeAccounts, { type Config } from '../src/index.ts'
import FixtureSubprocess, { signOutFixtureAccounts } from './fixture/subprocess.ts'

describe('native accounts service', () => {
  beforeEach(signOutFixtureAccounts)
  it('runs every native tool in the configured working directory', async () => {
    const seen: SubprocessSpawnSpec[] = []
    class RecordingSubprocess extends FixtureSubprocess {
      override spawn(spec: SubprocessSpawnSpec): SubprocessHandle { seen.push(spec); return super.spawn(spec) }
    }
    const ctx = new Context()
    await ctx.plugin(RecordingSubprocess)
    const fiber = ctx.plugin(NativeAccounts, { cwd: '/srv/native-workspace', probeTimeoutMs: 2000 } as Config)
    await fiber.await()
    try {
      await ctx.nativeAccounts.describe()
      expect(seen.length).toBeGreaterThan(1)
      expect(new Set(seen.map(spec => spec.cwd))).toEqual(new Set(['/srv/native-workspace']))
    } finally {
      await fiber.dispose()
    }
  })

  it('reads status, completes a manual-code sign-in, and withdraws everything on disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(FixtureSubprocess)
    // The Loader-equivalent schema pass fills every other limit at load.
    const fiber = ctx.plugin(NativeAccounts, { probeTimeoutMs: 2000, loginTimeoutMs: 5000, pollIntervalMs: 100 } as Config)
    await fiber.await()
    const service = ctx.nativeAccounts
    try {
      const accounts = await service.describe()
      expect(accounts.map(account => [account.provider, account.availability, account.status, account.loginInFlight])).toEqual([
        ['claude-code', 'available', 'disconnected', false], ['codex', 'available', 'disconnected', false],
        ['antigravity', 'unavailable', 'unknown', false],
      ])
      expect(accounts.find(account => account.provider === 'codex')?.loginModes).toEqual(['browser', 'device-code'])

      const attempt = service.begin('claude-code')
      expect(attempt).toMatchObject({ provider: 'claude-code', state: 'starting', pollAfterMs: 100 })
      await vi.waitFor(() => { expect(service.poll(attempt.id)).toMatchObject({
        state: 'waiting', input: 'code', url: 'https://claude.com/oauth/authorize?state=test-state',
      }) })
      expect(service.submit(attempt.id, 'fixture-code').input).toBeUndefined()
      await vi.waitFor(() => { expect(service.poll(attempt.id).state).toBe('connected') })
      const settled = await service.cancel(attempt.id)
      expect(settled.state).toBe('connected')
      expect(JSON.stringify(settled)).not.toContain('fixture-code')
      expect(JSON.stringify(settled)).not.toContain('MUST-NOT-LEAK')
    } finally {
      await fiber.dispose()
    }
    await expect(service.describe()).rejects.toThrow('unavailable')
  })

  it('signs in to the configured Antigravity CLI and then lists its models', async () => {
    const ctx = new Context()
    await ctx.plugin(FixtureSubprocess)
    const fiber = ctx.plugin(NativeAccounts, { probeTimeoutMs: 2000, loginTimeoutMs: 5000, pollIntervalMs: 100,
      antigravityExecutable: process.execPath } as Config)
    await fiber.await()
    const service = ctx.nativeAccounts
    try {
      const antigravity = async () => (await service.describe()).find(account => account.provider === 'antigravity')
      expect(await antigravity()).toMatchObject({ availability: 'available', status: 'disconnected', loginModes: ['browser'] })
      const attempt = service.begin('antigravity')
      await vi.waitFor(() => { expect(service.poll(attempt.id)).toMatchObject({
        state: 'waiting', input: 'code', url: 'https://accounts.google.com/o/oauth2/auth?state=test-state',
      }) })
      service.submit(attempt.id, 'fixture-code')
      await vi.waitFor(() => { expect(service.poll(attempt.id).state).toBe('connected') })
      expect(await antigravity()).toMatchObject({ status: 'connected', models: [{ id: 'gemini-3-pro', name: 'Gemini 3 Pro' }] })
    } finally {
      await fiber.dispose()
    }
  })

  it.each(['/opt/agy/bin/agy', 'C:\\Users\\me\\agy.exe', '\\\\host\\share\\agy.exe'])('accepts the absolute Antigravity executable %s', (path) => {
    expect(NativeAccounts.Config({ antigravityExecutable: path } as Config).antigravityExecutable).toBe(path)
  })
  it.each(['bin/agy', 'agy', '~/.local/bin/agy'])('refuses the relative Antigravity executable %s at load', (path) => {
    expect(() => NativeAccounts.Config({ antigravityExecutable: path } as Config)).toThrow()
  })
})
