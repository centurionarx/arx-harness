/**
 * USER-only HTTP consumer of owner-scoped project and history storage.
 * @module @arx-ai/arx-project-storage/http
 */
import type { Context } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { once } from 'node:events'
import { SessionId } from '@arx-ai/arx-session'
import { ModuleId, ProjectId, WebIdentityError } from '@arx-ai/arx-web-identity'
import type { OwnerResource, RequestAuthority, WebUserId, WebAuthSessionId } from '@arx-ai/arx-web-identity'
import type {} from '@arx-ai/arx-host-webserver'
import type { WorkspaceId } from '@arx-ai/arx-workspace'
import type {} from './index.ts'
import { assertOwnerHttpAccess } from './http-policy.ts'

interface HistoryPublication {
  readonly authority: RequestAuthority
  readonly sessionId: SessionId
  readonly controller: AbortController
  readonly response: ServerResponse
  readonly closed: Promise<void>
}

/** USER route body buffering limit. */
export interface HttpConfig { readonly maxRequestBytes: number }
/** Stable consumer plugin name. */
export const name = 'project-storage-http'
/** All route contributions wait for genuine identity and storage providers. */
export const inject = ['projectStorage', 'webIdentity', 'webIdentityApi', 'webServer']
/** Explicit deployment limit, shared by every mutation. */
export const Config: z<HttpConfig> = z.object({ maxRequestBytes: z.number().step(1).min(1).required() })

function problem(code: string, status: number, message: string): never { throw new WebIdentityError(code, status, message) }
function id(value: string): string { return ProjectId(value) }
function field(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 120 || Object.keys(body).some(name => name !== key)) {
    problem('PROJECT_INPUT', 400, 'Invalid display name')
  }
  return value.trim()
}
async function body(request: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') problem('PROJECT_MEDIA', 415, 'JSON required')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > limit) problem('PROJECT_LIMIT', 413, 'Request too large')
    chunks.push(bytes)
  }
  let value: unknown
  try { value = JSON.parse(Buffer.concat(chunks).toString()) }
  catch { problem('PROJECT_INPUT', 400, 'Invalid JSON') }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) problem('PROJECT_INPUT', 400, 'Invalid request')
  return value as Record<string, unknown>
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' })
  response.end(JSON.stringify(value))
}

/**
 * Register USER owner routes with the same request authentication and CSRF
 * policy used by login and administration. No route accepts a host path.
 * @param ctx - Real Cordis storage, request-authentication and webServer providers.
 * @param config - Explicit request byte limit.
 */
export function apply(ctx: Context, config: HttpConfig): void {
  if (ctx.webIdentityApi.audience !== 'user') throw new Error('project storage routes require the USER audience')
  const publications = new Set<HistoryPublication>()
  const joins = new Map<string | undefined, Promise<void>>()
  let stopped = false
  function admission(authority: RequestAuthority): void {
    if (stopped || joins.has(undefined) || joins.has('user:' + authority.principal.userId)
      || joins.has('session:' + authority.authSessionId)) {
      problem('PROJECT_UNAVAILABLE', 503, 'History publication unavailable')
    }
  }
  async function completedActivity(authority: RequestAuthority, signal: AbortSignal,
    resource?: OwnerResource): Promise<void> {
    signal.throwIfAborted()
    admission(authority)
    await ctx.webIdentity.revalidate(authority)
    if (resource !== undefined) await ctx.webIdentity.authorizeOwner(authority, resource, ModuleId('storage'))
    signal.throwIfAborted()
    admission(authority)
    await ctx.webIdentity.revalidate(authority, { activity: true })
    if (resource !== undefined) await ctx.webIdentity.authorizeOwner(authority, resource, ModuleId('storage'))
    else await ctx.webIdentity.revalidate(authority)
    assertOwnerHttpAccess(authority.principal, authority.audience)
    admission(authority)
    signal.throwIfAborted()
  }
  function registerPublication(authority: RequestAuthority, sessionId: SessionId,
    response: ServerResponse, controller: AbortController): HistoryPublication {
    controller.signal.throwIfAborted()
    admission(authority)
    const publication: HistoryPublication = { authority, sessionId, response, controller,
      closed: new Promise<void>((resolve) => {
        response.once('close', () => { publications.delete(publication); resolve() })
      }) }
    publications.add(publication)
    return publication
  }
  async function current(publication: HistoryPublication): Promise<void> {
    await ctx.webIdentity.authorizeOwner(publication.authority,
      { kind: 'session', sessionId: publication.sessionId }, ModuleId('storage'))
    publication.controller.signal.throwIfAborted()
    admission(publication.authority)
  }
  function quiesce(userId?: WebUserId, authSessionId?: WebAuthSessionId): Promise<void> {
    const key = authSessionId === undefined ? userId === undefined ? undefined : 'user:' + userId : 'session:' + authSessionId
    const prior = joins.get(key)
    if (prior !== undefined) return prior
    const selected = [...publications].filter(publication => userId === undefined
      || publication.authority.principal.userId === userId)
      .filter(publication => authSessionId === undefined || publication.authority.authSessionId === authSessionId)
    // Install the admission barrier before abort callbacks or response closure.
    const joined = Promise.resolve().then(async () => {
      try {
        for (const publication of selected) {
          publication.controller.abort(new Error('History publication cancelled'))
          publication.response.destroy()
        }
        await Promise.all(selected.map(publication => publication.closed))
      } finally { joins.delete(key) }
    })
    joins.set(key, joined)
    return joined
  }
  ctx.on('web-identity/invalidated', async (userId) => { await quiesce(userId) })
  ctx.on('web-identity/ownership-deleted', async (userId) => { await quiesce(userId) })
  ctx.on('web-identity/session-expired', async (userId, authSessionId) => { await quiesce(userId, authSessionId) })
  ctx.effect(() => async () => { stopped = true; await quiesce() })
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/user',
    handler: async (request, response) => {
      const controller = new AbortController()
      response.once('close', () =>{  controller.abort() })
      try {
        const method = request.method as string
        const authority = await ctx.webIdentityApi.authenticateRequest(request, { mutating: !['GET', 'HEAD'].includes(method) })
        assertOwnerHttpAccess(authority.principal, authority.audience)
        admission(authority)
        const url = new URL(request.url as string, 'http://arx.invalid')
        const segments = url.pathname.split('/').filter(Boolean)
        const cursor = url.searchParams.get('cursor') ?? undefined
        if ([...url.searchParams.keys()].some(key => !['cursor',
          'workspaceId'].includes(key))) problem('PROJECT_INPUT', 400, 'Invalid query')
        const storage = ctx.projectStorage
        if (segments.length === 2 && segments[1] === 'projects') {
          if (method === 'GET') { json(response, 200, await storage.projects(authority, cursor)); return }
          if (method === 'POST') {
            const project = await storage.createProject(authority, field(await body(request, config.maxRequestBytes), 'name'))
            await completedActivity(authority, controller.signal, { kind: 'project', projectId: project.projectId })
            json(response, 201, { project }); return
          }
        }
        if (segments.length === 4 && segments[1] === 'projects') {
          const projectId = ProjectId(id((segments[2] as string)))
          if (segments[3] === 'workspaces') {
            if (method === 'GET') { json(response, 200, await storage.workspaces(authority, projectId, cursor)); return }
            if (method === 'POST') {
              const workspace = await storage.createWorkspace(authority, projectId, field(await body(request, config.maxRequestBytes), 'name'))
              await completedActivity(authority, controller.signal, { kind: 'workspace', workspaceId: workspace.workspaceId })
              json(response, 201, { workspace }); return
            }
          }
          if (segments[3] === 'sessions' && method === 'GET') {
            const workspace = url.searchParams.get('workspaceId')
            const resource = workspace === null ? { kind: 'project' as const, projectId }
              : { kind: 'workspace' as const, workspaceId: id(workspace) as WorkspaceId }
            if (workspace !== null) {
              const owner = await ctx.webIdentity.authorizeOwner(authority, resource)
              if (owner.projectId !== projectId) problem('PROJECT_DENIED', 403, 'Workspace unavailable')
            }
            json(response, 200, await storage.list(authority, resource, cursor)); return
          }
        }
        if (segments.length === 4 && segments[1] === 'workspaces' && segments[3] === 'grouping' && method === 'DELETE') {
          const workspaceId = id((segments[2] as string)) as WorkspaceId
          await storage.removeGrouping(authority, workspaceId)
          await completedActivity(authority, controller.signal, { kind: 'workspace', workspaceId })
          json(response, 200, { ungrouped: true }); return
        }
        if (segments.length >= 3 && segments[1] === 'sessions') {
          const sessionId = SessionId(decodeURIComponent((segments[2] as string)))
          if (segments.length === 3) {
            if (method === 'PATCH') {
              const session = await storage.rename(authority, sessionId, field(await body(request, config.maxRequestBytes), 'title'))
              await completedActivity(authority, controller.signal, { kind: 'session', sessionId })
              json(response, 200, { session }); return
            }
            if (method === 'DELETE') {
              await storage.deleteSession(authority, sessionId)
              await completedActivity(authority, controller.signal)
              json(response, 200, { deleted: true }); return
            }
          }
          if (segments.length === 4 && segments[3] === 'history' && method === 'GET') {
            const publication = registerPublication(authority, sessionId, response, controller)
            const page = await storage.read(authority, sessionId, cursor, controller.signal)
            await current(publication)
            json(response, 200, page); return
          }
          if (segments.length === 4 && segments[3] === 'export' && method === 'GET') {
            const publication = registerPublication(authority, sessionId, response, controller)
            let page = await storage.read(authority, sessionId, undefined, controller.signal)
            await current(publication)
            response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8',
              'content-disposition': 'attachment; filename="session.jsonl"', 'cache-control': 'no-store',
              'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' })
            for (;;) {
              await current(publication)
              if (!response.write(page.content)) {
                await once(response, 'drain', { signal: controller.signal })
                await current(publication)
              }
              if (page.nextCursor === undefined) break
              page = await storage.read(authority, sessionId, page.nextCursor, controller.signal)
            }
            response.end(); return
          }
        }
        json(response, 404, { error: { code: 'PROJECT_ROUTE', message: 'Route unavailable' } })
      } catch (error) {
        if (controller.signal.aborted) { response.destroy(); return }
        if (response.headersSent) { response.destroy(); return }
        if (error instanceof WebIdentityError) json(response, error.status, { error: { code: error.code, message: error.message } })
        else if (error instanceof URIError || error instanceof SyntaxError || (error instanceof Error
          && error.message.startsWith('invalid '))) {
          json(response, 400, { error: { code: 'PROJECT_INPUT', message: 'Invalid request' } })
        } else { json(response, 500, { error: { code: 'PROJECT_UNAVAILABLE', message: 'Storage unavailable' } }) }
      }
    },
  }))
}
