/** Keyless native login transcript through the real Loader composition. */
import { boot, resolveConfigPath } from '@arx-ai/arx-app-boot'
import type {} from '@arx-ai/arx-native-accounts'
const path = process.argv[2]
if (!path) throw new Error('Missing fixture configuration')
const ctx = await boot('native-account-fixture', resolveConfigPath(path, undefined))
try {
  const accounts = await ctx.nativeAccounts.describe()
  console.log(accounts.map(account => `${account.label}: ${account.status}`).join('\n'))
  const attempt = ctx.nativeAccounts.begin('claude-code')
  while (ctx.nativeAccounts.poll(attempt.id).input !== 'code') await new Promise(resolve => setTimeout(resolve, 5))
  console.log('Claude Code: browser link and code prompt')
  ctx.nativeAccounts.submit(attempt.id, 'fixture-code')
  while (ctx.nativeAccounts.poll(attempt.id).state !== 'connected') await new Promise(resolve => setTimeout(resolve, 5))
  console.log('Claude Code: connected')
} finally { await ctx.fiber.dispose() }
