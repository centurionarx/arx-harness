import { createHmac } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@arx-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'
import { createGitHubWebhookIntegration, githubSecretRef } from '../src/handler.ts'
import type { GitHubWebhookHandlerConfig } from '../src/handler.ts'
import type { VerifiedWebhookDelivery, WebhookAdmission, WebhookRule } from '@arx-ai/arx-webhook'

const config = {
  source: 'source', ruleId: 'rule', path: '/hooks/github', secretEnv: 'GITHUB_WEBHOOK_SECRET', maxBodyBytes: 4096,
  repositories: ['owner/repo'], events: ['issues'], projectId: 'project', workspaceId: 'workspace',
  agentPreset: 'standard', permissionPreset: 'workspace-write', instruction: 'Review this issue.',
} satisfies Config

function fixture(model?: Config['model']) {
  const ctx = new Context()
  const resolve = vi.fn(async (): Promise<{ value: string } | undefined> => ({ value: 'secret' }))
  const accept = vi.fn(async (_delivery: VerifiedWebhookDelivery<'github'>): Promise<WebhookAdmission> => 'accepted')
  let registered: WebhookRule<'github'> | undefined
  const disposeRule = vi.fn(async () => {})
  ctx.provide('credentials', { resolve } as never)
  ctx.provide('webhookRuntime', { accept, register: (rule: WebhookRule<'github'>) => { registered = rule; return disposeRule } } as never)
  const settings: GitHubWebhookHandlerConfig = {
    ...config, secretEnv: githubSecretRef(config.secretEnv), repositories: new Set(config.repositories),
    events: new Set(config.events), ...(model === undefined ? {} : { model }),
  }
  const integration = createGitHubWebhookIntegration(ctx, settings)
  return { ctx, resolve, accept, integration, rule: () => registered!, disposeRule }
}

async function call(harness: ReturnType<typeof fixture>, options: {
  body?: Buffer
  method?: string
  contentType?: string | null
  distinct?: Record<string, string[]>
} = {}) {
  const body = options.body ?? Buffer.from(JSON.stringify({ repository: { full_name: 'owner/repo' } }))
  const headersDistinct = {
    'x-hub-signature-256': [`sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`],
    'x-github-delivery': ['delivery'], 'x-github-event': ['issues'], ...options.distinct,
  }
  const request = {
    method: options.method ?? 'POST', complete: true,
    headers: options.contentType === null ? {} : { 'content-type': options.contentType ?? 'application/json' },
    headersDistinct, resume: vi.fn(), async * [Symbol.asyncIterator]() { yield body },
  } as unknown as IncomingMessage
  const writeHead = vi.fn<(status: number, headers?: Record<string, string>) => void>()
  const end = vi.fn<(message?: string) => void>()
  const setHeader = vi.fn<(name: string, value: string) => void>()
  await harness.integration.route.handler(request, { writeHead, end, setHeader } as unknown as ServerResponse)
  return { status: writeHead.mock.calls[0]?.[0], text: end.mock.calls[0]?.[0], setHeader }
}

describe('GitHub authenticated boundary responses', () => {
  it('rejects non-POST, absent/non-JSON content types, and duplicate or blank required headers', async () => {
    const h = fixture()
    const method = await call(h, { method: 'GET' })
    expect(method.status).toBe(405)
    expect(method.setHeader).toHaveBeenCalledWith('allow', 'POST')
    for (const contentType of [null, 'text/plain', 'application/json;charset=latin1', 'application/json;charset=utf-8;extra=value']) {
      expect((await call(h, { contentType })).status).toBe(415)
    }
    for (const values of [[], [''], ['a', 'b']]) {
      expect((await call(h, { distinct: { 'x-github-delivery': values } })).status).toBe(400)
    }
    expect((await call(h, { contentType: 'application/json; charset="UTF-8"' })).status).toBe(202)
    expect(h.accept).toHaveBeenCalledOnce()
  })

  it('rejects invalid signed UTF-8, JSON, and non-object payloads after verifying raw bytes', async () => {
    const h = fixture()
    for (const body of [Buffer.from([0xff]), Buffer.from('{'), Buffer.from('null'), Buffer.from('[]'), Buffer.from('true')]) {
      expect((await call(h, { body })).status).toBe(400)
    }
    expect(h.accept).not.toHaveBeenCalled()
  })

  it('silently ignores allowed signatures with an absent or disallowed repository/event', async () => {
    const h = fixture()
    for (const repository of [null, [], 'owner/repo', {}, { full_name: '' }, { full_name: 1 }, { full_name: 'other/repo' }]) {
      expect((await call(h, { body: Buffer.from(JSON.stringify({ repository })) })).status).toBe(204)
    }
    expect((await call(h, { distinct: { 'x-github-event': ['push'] } })).status).toBe(204)
    expect(h.accept).not.toHaveBeenCalled()
  })

  it('returns unavailable for missing credentials or a disappeared rule', async () => {
    const h = fixture()
    h.resolve.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ value: '' })
    expect((await call(h)).status).toBe(503)
    expect((await call(h)).status).toBe(503)
    h.accept.mockResolvedValueOnce('no-rule')
    expect((await call(h)).status).toBe(503)
  })

  it('preserves the configured model in the trusted rule request', async () => {
    const model = { provider: 'test', model: 'fixed', maxTokens: 256 }
    const h = fixture(model)
    await call(h)
    const result = await h.rule().run(h.accept.mock.calls[0]![0], new AbortController().signal)
    expect(result).toMatchObject({ model, projectId: 'project', workspaceId: 'workspace' })
    await h.integration.disposeRule()
    expect(h.disposeRule).toHaveBeenCalledOnce()
  })
})

describe('GitHub adapter configuration', () => {
  it('refuses ambiguous paths, duplicate allowlists, and untrimmed policy before registering', () => {
    const h = fixture()
    const register = vi.fn()
    h.ctx.provide('webServer', { register } as never)
    for (const partial of [
      { source: '' }, { instruction: ' policy' }, { path: '/' }, { path: 'hooks' }, { path: '/hooks/' }, { path: '/hooks?x' }, { path: '/hooks#x' },
      { repositories: [] }, { repositories: ['owner/repo', 'owner/repo'] }, { events: [] }, { events: ['issues', 'issues'] }, { events: [' issues'] },
      { model: { provider: ' test', model: 'fixed' } }, { model: { provider: 'test', model: '' } },
    ]) expect(() => { apply(h.ctx, { ...config, ...partial }) }).toThrow('webhook-github')
    expect(register).not.toHaveBeenCalled()
  })

  it('owns the configured model, route and asynchronous rule disposer together', async () => {
    const h = fixture()
    const disposeRoute = vi.fn()
    h.ctx.provide('webServer', { register: () => disposeRoute } as never)
    apply(h.ctx, { ...config, model: { provider: 'test', model: 'fixed' } })
    await h.ctx.fiber.dispose()
    expect(disposeRoute).toHaveBeenCalledOnce()
    expect(h.disposeRule).toHaveBeenCalledOnce()
  })
})


it('rolls back and drains the rule when route registration fails', async () => {
  const h = fixture()
  const release = Promise.withResolvers<undefined>()
  h.disposeRule.mockImplementationOnce(() => release.promise)
  h.ctx.provide('webServer', { register: () => { throw new Error('route already exists') } } as never)
  expect(() => { apply(h.ctx, config) }).toThrow('route already exists')
  const unloading = h.ctx.fiber.dispose()
  let settled = false
  void unloading.then(() => { settled = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(h.disposeRule).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
  } finally {
    release.resolve(undefined)
    await unloading
  }
})
