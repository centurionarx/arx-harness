/** Both native and harness authorization envelopes bypass even overridden diagnostic taps. */
import { describe, expect, it } from 'vitest'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import type { ApiProxy } from '../src/api/index.ts'
import type { RpcMessage, RpcRequest } from '../src/api/rpc.ts'

class ObservedClient extends InProcessApiClient {
  readonly observed: RpcMessage[] = []
  protected override onEnvelope(message: RpcMessage): void { this.observed.push(message); super.onEnvelope(message) }
}
describe('private authorization carrier', () => {
  it('keeps all private request and response envelopes away from taps', async () => {
    const refusal = async (request: RpcRequest<unknown>) => ({ rpcId: request.rpcId, result: { ok: false as const, error: { code: 'internal' as const, message: 'Private auth status', details: {} } } })
    const domain = { describe: refusal, begin: refusal, poll: refusal, submit: refusal, cancel: refusal }
    const api = { authorization: domain, nativeAccounts: domain } as ApiProxy
    const client = new ObservedClient(toFetchHandler(api))
    const batched: RpcMessage[] = []
    client.subscribeEnvelopes(batch => batched.push(...batch))
    const attemptId = '123e4567-e89b-42d3-a456-426614174000' as never
    await client.authorization.describe({})
    await client.authorization.begin({ key: 'llm-pi-ai/openai-codex' as never })
    await client.authorization.poll({ attemptId })
    await client.authorization.submit({ attemptId, promptId: attemptId, answer: 'private-code' })
    await client.authorization.cancel({ attemptId })
    await client.nativeAccounts.describe({})
    await client.nativeAccounts.begin({ provider: 'codex' })
    await client.nativeAccounts.poll({ attemptId })
    await client.nativeAccounts.submit({ attemptId, code: 'private-code' })
    await client.nativeAccounts.cancel({ attemptId })
    expect(client.observed).toEqual([])
    expect(batched).toEqual([])
  })
})
