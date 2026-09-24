/** Real service routing through the HTTP envelope carrier, without starting external OAuth. */
import { Context } from '@arx-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentRegistry from '@arx-ai/arx-agent'
import SessionStore from '@arx-ai/arx-session'
import SystemPrompt from '@arx-ai/arx-system-prompt'
import ToolRuntime from '@arx-ai/arx-tools'
import UserQuestionService from '@arx-ai/arx-user-questions'
import LlmRuntime from '@arx-ai/arx-llm'
import AuthorizationService from '@arx-ai/arx-authorization'
import { credentialKey } from '@arx-ai/arx-credentials'
import { MemoryCredentials } from '../../../credentials/authorization/tests/memory.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import type { RpcMessage, RpcResponse } from '../src/api/rpc.ts'
import type { AuthorizationAttemptView } from '../src/api/authorization.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')
const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
async function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemoryCredentials)
  const api = createApiProxy(ctx, { defaultModelSelection: () => undefined, cwd: '/tmp' })
  const client = new InProcessApiClient(toFetchHandler(api))
  return { ctx, api, client }
}
function value<T>(response: RpcResponse<T>): T {
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value
}
describe('authorization service carrier', () => {
  it('supports late service injection and publishes only credential presence after a private prompt', async () => {
    const { ctx, client } = await bench()
    expect((await client.authorization.describe({})).result.ok).toBe(false)
    const fiber = ctx.plugin(AuthorizationService)
    await fiber.await()
    let received = ''
    ctx.authorization.registerFlow({ key: KEY, label: 'ChatGPT', methods: [{ id: 'oauth', label: 'Sign in' }],
      async run(session) {
        session.notify({ message: 'Open authorization', url: 'https://auth.openai.com/authorize' })
        received = await session.prompt({ kind: 'secret', message: 'Paste authorization code' })
        await ctx.credentials.modifyRecord(KEY, async () => ({ kind: 'grant', payload: { secret: received } }))
      } })
    const seen: RpcMessage[] = []
    client.subscribeEnvelopes(batch => seen.push(...batch))
    expect(value(await client.authorization.describe({})).flows[0]?.configured).toBe(false)
    const initial = value(await client.authorization.begin({ key: KEY, method: 'oauth' })).attempt
    let progress: AuthorizationAttemptView = initial
    await vi.waitFor(async () => {
      progress = value(await client.authorization.poll({ attemptId: initial.id })).attempt
      expect(progress.prompt?.kind).toBe('secret')
    })
    const submitted = value(await client.authorization.submit({ attemptId: initial.id, promptId: progress.prompt!.id, answer: 'private-test-code' }))
    expect(JSON.stringify(submitted)).not.toContain('private-test-code')
    await vi.waitFor(async () => expect(value(await client.authorization.poll({ attemptId: initial.id })).attempt.state).toBe('authorized'))
    expect(received).toBe('private-test-code')
    expect(value(await client.authorization.describe({})).flows[0]?.configured).toBe(true)
    expect(seen).toEqual([])
    await fiber.dispose()
    expect((await client.authorization.describe({})).result.ok).toBe(false)
  })

  it('cancels through the attempt capability and joins the service interaction before disposal', async () => {
    const { ctx, client } = await bench()
    await ctx.plugin(AuthorizationService).await()
    let ended = false
    ctx.authorization.registerFlow({ key: KEY, label: 'ChatGPT', methods: [{ id: 'oauth', label: 'Sign in' }],
      async run(session) {
        try { await session.prompt({ kind: 'text', message: 'Code' }) } finally { ended = true }
      } })
    const { attempt } = value(await client.authorization.begin({ key: KEY }))
    expect(value(await client.authorization.cancel({ attemptId: attempt.id })).attempt.state).toBe('cancelled')
    await vi.waitFor(() => expect(ended).toBe(true))
    expect((await client.authorization.begin({ key: KEY, method: 'unknown' })).result.ok).toBe(false)
    const retry = value(await client.authorization.begin({ key: KEY })).attempt
    await ctx.fiber.dispose()
    expect((await client.authorization.poll({ attemptId: retry.id })).result.ok).toBe(false)
  })
})
