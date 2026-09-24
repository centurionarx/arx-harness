/** The account service through a real Cordis root; only the native product processes are substituted. */
import { Context } from '@arx-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'
import NativeAccounts, { type Config } from '../src/index.ts'
import FixtureSubprocess from './fixture/subprocess.ts'

describe('native accounts service', () => {
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
      expect(accounts.map(account => [account.provider, account.status, account.loginInFlight]))
        .toEqual([['claude-code', 'disconnected', false], ['codex', 'disconnected', false]])
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
})
