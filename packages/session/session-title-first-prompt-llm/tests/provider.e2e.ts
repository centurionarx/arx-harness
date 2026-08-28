import { createUserMessage } from '@arx-ai/arx-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@arx-ai/cordis'
import LlmRuntime from '@arx-ai/arx-llm'
import * as LlmPiAi from '@arx-ai/arx-llm-pi-ai'
import SessionStore, { SessionId } from '@arx-ai/arx-session'
import SessionTitleService from '@arx-ai/arx-session-title'
import * as FirstMessageTitleProvider from '@arx-ai/arx-session-title-first-prompt-llm'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe.skipIf(!process.env.PRIMARY_API_KEY)('first-prompt title provider with real Primary API', () => {
  it('replaces the fallback with a short model title', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: { primary: { apiKeyEnv: 'PRIMARY_API_KEY', reasoning: 'off' } } })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, {
      fallbackMaxWords: 5,
      fallbackMaxBytes: 40,
      maxTitleBytes: 80,
    })
    await ctx.plugin(FirstMessageTitleProvider, {
      targetWords: 5,
      targetCjkCharacters: 10,
      maxInputBytes: 4_096,
      maxOutputTokens: 64,
      timeoutMs: 60_000,
      provider: 'primary',
      model: 'primary-flash',
    })
    const session = ctx.sessions.create(SessionId('real-title-provider'))
    session.append('turn/start', {
      turn: 1,
    })
    const message = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Explain why append-only logs make session titles durable.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const title = await ctx.sessionTitle.refresh(session)

    expect(title).toMatchObject({
      messageSeqs: [message.seq],
      source: {
        kind: 'provider',
        provider: 'session-title-first-prompt-llm',
        model: { provider: 'primary', model: 'primary-flash' },
      },
    })
    expect(title?.title.length).toBeGreaterThan(0)
    expect(Buffer.byteLength(title?.title ?? '', 'utf8')).toBeLessThanOrEqual(80)
  })
})
