/**
 * Disposable real identity/storage/frontend server for native browser tests.
 * Credentials travel only over private IPC; bundled UI is served from the isolated build.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { resolve, join, relative } from 'node:path'
import { mkdtemp, mkdir, readdir, readFile, writeFile, realpath, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { symbols, type Context, type Plugin } from '@arx-ai/cordis'
import { pathToFileURL } from 'node:url'
import { identityHarness } from './harness.ts'
import { storageHarness } from '../../../packages/identity/project-storage/tests/harness.ts'
import { ModuleId, parseAuthState } from '@arx-ai/arx-web-identity/contract'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { MessageId, freezeMessage } from '@arx-ai/arx-llm'
import { installLlmReplay } from '@arx-ai/arx-llm-replay'
import { textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { WorkspaceId } from '@arx-ai/arx-workspace'
import * as BrokerHttp from '../../../packages/host/isolated-project-runtime/src/broker-http.ts'
import { nativeSupervisorFixture } from '../../../packages/host/isolated-project-runtime/tests/native-supervisor.ts'
import { USER_PROJECT_BASE, USER_RUNTIME_FEATURES, authenticatedGraph, nativeComposition } from '../../../packages/client/modules/src/authenticated-graph.ts'

const audience = process.argv[2] === 'admin' ? 'admin' : 'user'
const restricted = process.argv.includes('--first-password')
const frontend = process.argv.includes('--frontend')
const withRuntime = frontend && audience === 'user' && process.argv.includes('--runtime')
const supervisor = withRuntime ? await nativeSupervisorFixture({ fsTools: true }) : undefined
const workspaceVolumes = new Map<string, string>()
const previewReplays = new Map<string, ReturnType<typeof installLlmReplay>>()
let resolverRoot: string | undefined
const resolutionPackages: string[] = []
if (frontend) {
  const staging = await realpath(process.cwd())
  if (!staging.endsWith('/arx-harness-auth-20261008')) throw new Error('fixture requires isolated staging')
  resolverRoot = await mkdtemp(join(tmpdir(), 'arx-auth-resolution-'))
  for (const category of await readdir(join(staging, 'packages'), { withFileTypes: true })) {
    if (!category.isDirectory()) continue
    for (const directory of await readdir(join(staging, 'packages', category.name), { withFileTypes: true })) {
      if (!directory.isDirectory()) continue
      const target = await realpath(join(staging, 'packages', category.name, directory.name))
      if (relative(staging, target).startsWith('..')) throw new Error('fixture package target left staging')
      let pkg: { name: string }
      try { pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8')) as { name: string } }
      catch { continue }
      if (!/^@arx-ai\/[a-z0-9-]+$/.test(pkg.name)) continue
      const link = join(resolverRoot, 'node_modules', pkg.name)
      await mkdir(join(link, '..'), { recursive: true })
      await symlink(target, link, 'dir')
      resolutionPackages.push(pkg.name)
    }
  }
}
const fixtureRequire = createRequire(join(resolverRoot ?? process.cwd(), 'package.json'))
async function actualPackage(name: string): Promise<Plugin> {
  const raw: unknown = await import(pathToFileURL(fixtureRequire.resolve(name)).href)
  const value = typeof raw === 'object' && raw !== null && 'default' in raw ? raw.default ?? raw : raw
  if (!isActualPlugin(value)) throw new Error('real staging plugin export invalid')
  return value
}
function isActualPlugin(value: unknown): value is Plugin {
  return typeof value === 'function'
    || (typeof value === 'object' && value !== null && 'apply' in value && typeof value.apply === 'function')
}
const extraPlugins: Array<{ name: string; plugin: unknown; config?: unknown }> = []
if (frontend) {
  const roster = withRuntime ? [...USER_PROJECT_BASE, ...USER_RUNTIME_FEATURES]
    : ['@arx-ai/arx-client-slots', '@arx-ai/arx-client-locale', '@arx-ai/arx-client-ui-theme',
      '@arx-ai/arx-client-ui-renderer', '@arx-ai/arx-client-ui-auth']
  for (const name of new Set(roster.filter(value => value !== '@arx-ai/arx-client-modules'))) {
    const actual = await actualPackage(name)
    extraPlugins.push({ name, plugin: actual,
      ...(name === '@arx-ai/arx-client-connection' ? { config: { accessMode: 'authenticated' } } : {}) })
  }
  if (withRuntime) extraPlugins.unshift({ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp })
  extraPlugins.push({ name: '@arx-ai/arx-client-modules', plugin: await actualPackage('@arx-ai/arx-client-modules') })
  extraPlugins.push({ name: '@arx-ai/arx-host-frontend-static', plugin: await actualPackage('@arx-ai/arx-host-frontend-static'),
    config: { distIndex: resolve(process.cwd(), 'apps/web/dist/index.html') } })
}
const native = frontend ? { accessMode: 'authenticated' as const,
  packageBaseUrl: pathToFileURL(resolverRoot!).href + '/', extraPlugins } : {}
const fixture = audience === 'user' && !restricted
  ? await storageHarness({ http: true, ...(supervisor === undefined ? {} : { endpoint: supervisor.endpoint }), ...native })
  : await identityHarness({ api: audience, readyUsers: restricted ? 0 : 2, bootstrap: !restricted, ...native })
let bootstrapPassword: string | undefined
if (restricted) {
  bootstrapPassword = 'Fixture-' + randomBytes(24).toString('hex')
  await fixture.ctx.webIdentity.bootstrapMaster(bootstrapPassword)
}
if (frontend && audience === 'user' && !withRuntime) {
  // This is an HTTP-only USER deployment: real owner storage remains usable,
  // while unconfigured execution stays closed. No project services are fabricated.
  if (fixture.master === undefined) throw new Error('fixture master required')
  for (const user of fixture.users) await fixture.ctx.webIdentity.setModules(fixture.master, user.userId, [ModuleId('storage')])
}
let adminUrl: string | undefined
let adminScope: Context | undefined
if (frontend && audience === 'user') {
  // Two actual audience/origin providers share one identity/storage authority.
  // The scoped HTTP/module services cannot claim the parent USER registrations.
  const admin = fixture.ctx.isolate('webServer').isolate('webIdentityApi').isolate('clientModules').isolate('connection')
  adminScope = admin
  await admin.plugin(await actualPackage('@arx-ai/arx-host-webserver'),
    { host: '127.0.0.1', port: 0, accessMode: 'authenticated' })
  adminUrl = 'http://127.0.0.1:' + String(admin.webServer.port)
  await admin.plugin(await actualPackage('@arx-ai/arx-host-web-identity-api'),
    { audience: 'admin', origin: adminUrl, allowInsecureLoopbackFixture: true,
      invalidationTimeoutMs: 100, minimumRecoveryResponseMs: 0, publicRateLimitAttempts: 100 })
  await admin.plugin(await actualPackage('@arx-ai/arx-client-connection'), { accessMode: 'authenticated' })
  await admin.plugin(await actualPackage('@arx-ai/arx-client-modules'))
  await admin.plugin(await actualPackage('@arx-ai/arx-host-frontend-static'),
    { distIndex: resolve(process.cwd(), 'apps/web/dist/index.html') })
  admin.effect(() => admin.webServer.register({ kind: 'exact', path: '/fixture/index-diagnostic', handler: async (request, response) => {
    const safe = (cause: unknown): object => ({
      errorClass: cause instanceof Error ? cause.name : 'unknown',
      reason: cause instanceof Error && cause.message === 'Authenticated index renderer unavailable' ? 'index-unavailable'
        : cause instanceof Error && cause.message === 'webserver: request index renderer already registered' ? 'index-duplicate'
          : cause instanceof Error && cause.message === 'webserver: request renderer requires authenticated mode' ? 'mode-mismatch' : 'other',
      status: typeof cause === 'object' && cause !== null && 'status' in cause && typeof cause.status === 'number' ? cause.status : undefined,
      code: typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined,
    })
    let auth: object, render: object
    try { await admin.webIdentityApi.authenticateRequest(request); auth = { accepted: true } }
    catch (cause) { auth = { accepted: false, ...safe(cause) } }
    try { await admin.webServer.renderRequestIndex('<html><head></head><body></body></html>', request); render = { rendered: true } }
    catch (cause) { render = { rendered: false, ...safe(cause) } }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify({ auth, render }))
  } }), 'fixture: actual admin request-index diagnostic')
}
if (frontend) fixture.ctx.on('webserver/index-inject', (rows) => {
  rows.push({ kind: 'global', name: '__ARX_FORBIDDEN_GLOBAL_CONFIG__', value: { private: 'must-not-ship' } })
})
const close = async (): Promise<void> => {
  for (const replay of previewReplays.values()) replay.dispose()
  previewReplays.clear()
  await fixture.close()
  await supervisor?.close()
  if (resolverRoot !== undefined) await rm(resolverRoot, { recursive: true, force: true })
}
if (process.send === undefined) throw new Error('identity browser fixture requires private IPC')
process.send({ type: 'ready', url: fixture.url, adminUrl, audience,
  resolution: { packages: resolutionPackages.sort(), fixtureOnly: true },
  masterPassword: bootstrapPassword ?? fixture.passwords.master,
  users: fixture.users.map(row => ({ username: row.username, password: row.password })) })
process.on('message', (raw: unknown) => {
  if (typeof raw !== 'object' || raw === null) return
  const message = raw as {
    type?: unknown
    index?: unknown
    grants?: unknown
    purpose?: unknown
    to?: unknown
    workspaceId?: unknown
    sessionId?: unknown
  }
  void (async () => {
    if (message.type === 'close') { await close(); process.exit(0) }
    if (message.type === 'index-metadata') {
      if (adminScope === undefined || adminUrl === undefined) throw new Error('real admin scope unavailable')
      const graph = adminScope.clientModules.graph()
      const state = parseAuthState(await (await fetch(adminUrl + '/auth/session')).json())
      let applicationCount = 0, graphError: string | undefined
      try { applicationCount = authenticatedGraph(graph, nativeComposition(state)).length }
      catch (cause) { graphError = cause instanceof Error ? cause.message : 'invalid graph' }
      const original = (value: unknown): unknown => {
        if (typeof value !== 'object' || value === null) return value
        const candidate: unknown = Reflect.get(value, symbols.original)
        return typeof candidate === 'object' && candidate !== null ? candidate : value
      }
      const adminModules = original(adminScope.clientModules), userModules = original(fixture.ctx.clientModules)
      const adminServer = original(adminScope.webServer), userServer = original(fixture.ctx.webServer)
      const rendererInstalled = (provider: unknown): boolean => typeof provider === 'object' && provider !== null && Reflect.get(provider, 'requestIndexRenderer') !== undefined
      const fibers: object[] = []
      let fiberError: string | undefined
      try {
        for (const runtime of adminScope.registry.values()) {
          for (const fiber of runtime.fibers) {
            if (runtime.callback.name !== 'ClientModuleRegistry' && !Object.hasOwn(fiber.inject, 'webIdentityApi')) continue
            const failure: unknown = Reflect.get(fiber, '_error')
            fibers.push({ callback: runtime.callback.name, uid: fiber.uid, state: fiber.state, transitioning: fiber.inertia !== undefined,
              inject: Object.keys(fiber.inject), usesAdminWebServer: original(fiber.ctx.get('webServer')) === adminServer,
              usesAdminApi: original(fiber.ctx.get('webIdentityApi')) === original(adminScope.webIdentityApi),
              errorClass: failure instanceof Error ? failure.name : undefined,
              errorReason: failure instanceof Error && failure.message === 'webserver: request index renderer already registered' ? 'index-duplicate'
                : failure instanceof Error && failure.message === 'cannot create effect on inactive context' ? 'inactive-effect'
                  : failure instanceof Error && failure.message === 'webserver: request renderer requires authenticated mode' ? 'mode-mismatch'
                    : failure instanceof Error && failure.message === 'cannot get property "webServer" without inject' ? 'undeclared-webserver'
                      : failure instanceof Error && failure.message === 'cannot get property "loader" without inject' ? 'undeclared-loader'
                        : failure === undefined ? undefined : 'other' })
          }
        }
      } catch (cause) { fiberError = cause instanceof Error ? cause.name : 'unknown' }
      process.send?.({ type: 'index-metadata',
        identity: { sameModules: adminModules === userModules, sameServer: adminServer === userServer,
          rawAdminRendererInstalled: rendererInstalled(adminServer), rawUserRendererInstalled: rendererInstalled(userServer),
          callerAdminRendererInstalled: rendererInstalled(adminScope.webServer), fibers, fiberError },
        services: { modules: adminScope.get('clientModules') !== undefined, webServer: adminScope.get('webServer') !== undefined,
          identity: adminScope.get('webIdentity') !== undefined, api: adminScope.get('webIdentityApi') !== undefined,
          loader: adminScope.get('loader') !== undefined, audience: adminScope.webIdentityApi.audience,
          serverMode: adminScope.webServer.accessMode, separatePort: adminScope.webServer.port !== fixture.ctx.webServer.port },
        graph: { ids: graph.entries.map(entry => entry.id), rev: graph.rev, applicationCount, graphError },
        loader: [...adminScope.loader.entries()].map(entry => ({ name: entry.options.name, disabled: entry.disabled,
          state: entry.fiber?.state ?? 'absent' })),
      })
    }

    if (message.type === 'block-user' && typeof message.index === 'number') {
      const user = fixture.users[message.index]
      if (user === undefined || fixture.master === undefined) throw new Error('invalid fixture user')
      await fixture.ctx.webIdentity.setStatus(fixture.master, user.userId, 'BLOCKED')
      process.send?.({ type: 'blocked' })
    }
    if (message.type === 'set-modules' && typeof message.index === 'number' && Array.isArray(message.grants)) {
      const user = fixture.users[message.index]
      if (user === undefined || fixture.master === undefined) throw new Error('invalid fixture user')
      await fixture.ctx.webIdentity.setModules(fixture.master, user.userId, message.grants.map((value) => {
        if (typeof value !== 'string') throw new Error('invalid fixture grant')
        return ModuleId(value)
      }))
      process.send?.({ type: 'set-modules' })
    }
    if (message.type === 'seed-history' && typeof message.index === 'number') {
      const user = fixture.users[message.index]
      if (user === undefined || audience !== 'user') throw new Error('invalid fixture user')
      const login = await fixture.ctx.webIdentity.login(user.username, user.password, 'user')
      const owner = await fixture.ctx.webIdentity.authenticate(login.token, 'user')
      const project = await fixture.ctx.projectStorage.createProject(owner, 'Projeto privado ' + String(message.index))
      const workspace = await fixture.ctx.projectStorage.createWorkspace(owner, project.projectId, 'Workspace próprio ' + String(message.index))
      const header = await fixture.ctx.projectStorage.register(owner, workspace.workspaceId,
        { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: Date.now() })
      const session = Session.create(header.id, [], header)
      session.append('turn/start', { turn: 1 })
      session.append('user/message', freezeMessage({ id: MessageId(randomUUID()), role: 'user',
        content: [{ type: 'text', text: 'Registro próprio ' + String(message.index) }], source: { kind: 'user' } }),
      { surfaceOp: 'append' })
      if (withRuntime) {
        session.append('step/start', { turn: 1, step: 1 })
        session.append('assistant/message', { turn: 1, step: 1, message: freezeMessage({
          id: MessageId(randomUUID()), role: 'assistant',
          content: [{ type: 'text', text: 'Resposta privada ' + String(message.index) + ' — veja ' + String.fromCharCode(96) + 'malicious.html' + String.fromCharCode(96) + '.' }],
          source: { kind: 'model', provider: 'fixture', model: 'fixture' },
        }) }, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
      }
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      await fixture.ctx.projectStorage.append(owner, header.id, session.events)
      if (supervisor !== undefined) {
        const provision = await fixture.ctx.projectStorage.provision(owner, workspace.workspaceId)
        supervisor.assign({ controlOrigin: fixture.url!, scope: provision.scope, volumePath: provision.volumePath })
        workspaceVolumes.set(provision.scope.workspaceId, provision.volumePath)
        // Untrusted fixture document is on the owner's actual mounted volume.
        await writeFile(join(provision.volumePath, 'malicious.html'), '<h1>Own opaque preview</h1>'
          + '<script>parent.__ARX_PREVIEW_ATTACK__=true;parent.localStorage.setItem("arx.preview.attack","true");fetch("/auth/session",{credentials:"include"});parent.postMessage({type:"arx-auth-required"},"*")</script>'
          + '<img src="/auth/session" onerror="parent.__ARX_PREVIEW_ATTACK__=true">'
          + '<iframe src="/admin/users"></iframe><form action="/auth/logout"><button>attack</button></form>')
      }
      await fixture.ctx.projectStorage.rename(owner, header.id, 'Conversa privada ' + String(message.index))
      process.send?.({ type: 'seed-history', projectId: project.projectId, workspaceId: workspace.workspaceId, sessionId: header.id })
    }
    if (message.type === 'assign-workspace' && typeof message.index === 'number' && typeof message.workspaceId === 'string') {
      if (supervisor === undefined) throw new Error('native supervisor required')
      const user = fixture.users[message.index]
      if (user === undefined) throw new Error('invalid fixture user')
      const login = await fixture.ctx.webIdentity.login(user.username, user.password, 'user')
      const owner = await fixture.ctx.webIdentity.authenticate(login.token, 'user')
      const provision = await fixture.ctx.projectStorage.provision(owner, WorkspaceId(message.workspaceId))
      supervisor.assign({ controlOrigin: fixture.url!, scope: provision.scope, volumePath: provision.volumePath })
      workspaceVolumes.set(provision.scope.workspaceId, provision.volumePath)
      process.send?.({ type: 'assign-workspace', assigned: true })
    }
    if (message.type === 'configure-preview-replay' && typeof message.workspaceId === 'string' && typeof message.sessionId === 'string') {
      const ctx = supervisor?.ctxOf(message.workspaceId)
      const agent = ctx?.agents.get(SessionId(message.sessionId))
      const volumePath = workspaceVolumes.get(message.workspaceId)
      if (ctx === undefined || agent === undefined || volumePath === undefined) throw new Error('own worker not mounted')
      const content = '<h1>Own opaque preview</h1>'
        + '<script>parent.__ARX_PREVIEW_ATTACK__=true;parent.localStorage.setItem("arx.preview.attack","true");fetch("/auth/session",{credentials:"include"});parent.postMessage({method:"host.pickDirectory"},"*")</script>'
        + '<img src="/auth/session" onerror="parent.__ARX_PREVIEW_ATTACK__=true">'
        + '<iframe src="/admin/users"></iframe><form action="/auth/logout"><button>attack</button></form>'
      const chunks = [toolCallResponse('owned-browser-preview', 'write', { file_path: 'malicious.html', content }),
        textResponse('Preview fixture ready: ' + String.fromCharCode(96) + 'malicious.html' + String.fromCharCode(96) + '.')]
      const records = [{ type: 'session', id: 'native-browser-preview-recording', createdAt: 1 },
        ...chunks.flatMap((rows, step) => rows.map(chunk => ({ type: 'assistant/chunk', data: { turn: 2, step: step + 1, chunk } })))]
      const replayPath = join(volumePath, 'native-browser-preview-replay.jsonl')
      await writeFile(replayPath, records.map(row => JSON.stringify(row)).join('\n') + '\n')
      const replay = installLlmReplay(ctx, { file: replayPath,
        providers: [{ id: 'native-preview', models: [{ id: 'native-preview-model' }] }] })
      previewReplays.get(message.sessionId)?.dispose()
      previewReplays.set(message.sessionId, replay)
      process.send?.({ type: 'configure-preview-replay', configured: true, provider: 'native-preview', model: 'native-preview-model' })
    }
    if (message.type === 'finish-preview-replay' && typeof message.workspaceId === 'string' && typeof message.sessionId === 'string') {
      const ctx = supervisor?.ctxOf(message.workspaceId)
      const agent = ctx?.agents.get(SessionId(message.sessionId))
      const replay = previewReplays.get(message.sessionId)
      if (ctx === undefined || agent === undefined || replay === undefined) throw new Error('own replay not configured')
      await agent.whenIdle()
      await ctx.sessions.flush(agent.session)
      replay.assertConsumed()
      replay.dispose(); previewReplays.delete(message.sessionId)
      process.send?.({ type: 'finish-preview-replay', consumed: true, ...supervisor?.counts })
    }
    if (message.type === 'ask-question' && typeof message.workspaceId === 'string' && typeof message.sessionId === 'string') {
      const ctx = supervisor?.ctxOf(message.workspaceId)
      const agent = ctx?.agents.get(SessionId(message.sessionId))
      if (ctx === undefined || agent === undefined) throw new Error('own native session not mounted')
      const asked = ctx.userQuestions.ask({ agent, questions: [{ id: 'owner-choice', question: 'Choose the owned result',
        options: [{ label: 'Continue' }] }] })
      process.send?.({ type: 'ask-question', pending: true })
      void asked.then(() => process.send?.({ type: 'question-answered', answered: true }),
        () => process.send?.({ type: 'question-ended', ended: true }))
    }
    if (message.type === 'restart-workers') {
      if (supervisor === undefined) throw new Error('native supervisor required')
      for (const replay of previewReplays.values()) replay.dispose()
      previewReplays.clear()
      await supervisor.restart()
      process.send?.({ type: 'restart-workers', restarted: true })
    }
    if (message.type === 'worker-counts') {
      if (supervisor === undefined) throw new Error('native supervisor required')
      process.send?.({ type: 'worker-counts', ...supervisor.counts })
    }
    if (message.type === 'recovery-link') {
      await fixture.ctx.webIdentity.flushOutbox()
      const purpose = message.purpose === 'invitation' ? 'invitation' : 'reset'
      const mail = fixture.deliveries.findLast(row => row.purpose === purpose
        && (message.to === undefined || row.to === message.to))
      process.send?.({ type: 'recovery-link', link: mail?.link })
    }

  })().catch(() => { process.send?.({ type: 'fixture-error' }) })
})
process.on('disconnect', () => { void close().finally(() => { process.exit(0) }) })
