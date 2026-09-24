import { writeFile } from 'node:fs/promises'
import { Context } from '@arx-ai/cordis'
import LocalSubprocess from '@arx-ai/arx-subprocess-local'
import { describe, expect, it } from 'vitest'
import NativeAccounts, { type Config } from '../src/index.ts'

describe.skipIf(process.env.ARX_NATIVE_ACCOUNTS_SMOKE !== '1')('installed native account discovery', () => {
  it('reads sanitized status and initializes native model metadata without a paid turn', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSubprocess)
    // The Loader-equivalent schema pass fills every default at load.
    await ctx.plugin(NativeAccounts, {} as Config)
    try {
      const accounts = await ctx.nativeAccounts.describe()
      expect(accounts.map(account => account.provider)).toEqual(['claude-code', 'codex'])
      await writeFile('.arx-build/native-account-smoke-safe.json', JSON.stringify(accounts.map(account => ({ provider: account.provider, availability: account.availability,
        status: account.status, authMode: account.authMode,
        models: account.models?.map(model => ({ id: model.id, resolvedModel: model.resolvedModel })) }))))
      for (const account of accounts) {
        expect(account).not.toHaveProperty('email')
        expect(account).not.toHaveProperty('accountId')
        expect(account).not.toHaveProperty('accessToken')
      }
    } finally { await ctx.fiber.dispose() }
  }, 30000)
})
