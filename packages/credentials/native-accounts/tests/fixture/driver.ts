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
  const codex = ctx.nativeAccounts.begin('codex', 'browser')
  while (ctx.nativeAccounts.poll(codex.id).input !== 'redirect-url') await new Promise(resolve => setTimeout(resolve, 5))
  console.log('OpenAI Codex: browser link and return-address prompt')
  // What a browser on another machine shows after sign-in: the return address it could not open.
  const redirect = new URL(ctx.nativeAccounts.poll(codex.id).url!).searchParams.get('redirect_uri')!
  ctx.nativeAccounts.submit(codex.id, `${redirect}?code=fixture-callback&state=fixture`)
  while (ctx.nativeAccounts.poll(codex.id).state !== 'connected') await new Promise(resolve => setTimeout(resolve, 5))
  console.log('OpenAI Codex: connected')
} finally { await ctx.fiber.dispose() }
