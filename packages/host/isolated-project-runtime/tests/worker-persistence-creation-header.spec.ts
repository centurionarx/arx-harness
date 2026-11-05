import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@arx-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId } from '@arx-ai/arx-session'
import OwnedWorkerPersistence from '../src/worker-persistence.ts'
import { WORKER_BROKER_PATH, WORKER_CAPABILITY_HEADER } from '../src/broker-contract.ts'

const sessionId = SessionId('11111111-1111-4111-8111-111111111111')
const volumePath = '/mnt/worker'
const capability = 'A'.repeat(43)

function contextWithSessions(): Context {
  const ctx = new Context()
  ;(ctx as unknown as { sessions: unknown }).sessions = { get: () => undefined, list: () => [] }
  return ctx
}

function persistence(): OwnedWorkerPersistence {
  const p = new OwnedWorkerPersistence(contextWithSessions(), {
    controlOrigin: 'https://control.example', workerId: '22222222-2222-4222-8222-222222222222',
    userId: 'u', projectId: 'p', workspaceId: 'w', volumePath,
    requestTimeoutMs: 1000, maxResponseBytes: 10_000, rawPageBytes: 64,
  })
  p.bind(capability, { userId: 'u', projectId: 'p', workspaceId: 'w' } as never)
  return p
}

function reply(value: unknown) {
  const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify({ value })))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const header = { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, cwd: volumePath }

describe('OwnedWorkerPersistence.readCreationHeader', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns the header without agentPreset when control omits it', async () => {
    const fetchMock = reply(header)
    expect(await persistence().readCreationHeader(sessionId)).toEqual(header)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(new URL(WORKER_BROKER_PATH, 'https://control.example').href)
    expect((init.headers as Record<string, string>)[WORKER_CAPABILITY_HEADER]).toBe(capability)
    expect(JSON.parse(init.body as string)).toMatchObject({ operation: 'creation-header', sessionId })
  })

  it('keeps agentPreset when control supplies it', async () => {
    reply({ ...header, agentPreset: 'coder' })
    expect(await persistence().readCreationHeader(sessionId)).toEqual({ ...header, agentPreset: 'coder' })
  })

  it('refuses a header for another session', async () => {
    reply({ ...header, id: SessionId('33333333-3333-4333-8333-333333333333') })
    await expect(persistence().readCreationHeader(sessionId)).rejects.toThrow('worker creation header differs')
  })

  it('refuses a header whose cwd is not the worker volume', async () => {
    reply({ ...header, cwd: '/elsewhere' })
    await expect(persistence().readCreationHeader(sessionId)).rejects.toThrow('worker creation header differs')
  })
})
