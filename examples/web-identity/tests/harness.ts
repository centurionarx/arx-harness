/** Real Loader identity fixtures. Only outbound delivery is replaced. */
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import Include from '@arx-ai/cordis-plugin-include'
import Journal from '@arx-ai/arx-identity-authority-journal'
import SqliteIdentity from '@arx-ai/arx-web-identity-sqlite'
import HttpServer from '@arx-ai/arx-host-webserver'
import type { Config as IdentityConfig } from '@arx-ai/arx-web-identity-sqlite'
import type { Config as ApiConfig } from '@arx-ai/arx-host-web-identity-api'
import IdentityApi from '@arx-ai/arx-host-web-identity-api'
import type { ServerResponse } from 'node:http'
import type { AuthAudience, AuthInvalidation, IdentityDelivery, RequestAuthority, WebUserId } from '@arx-ai/arx-web-identity'
export interface IdentityHarnessOptions {
  root?: string
  initialize?: boolean
  bootstrap?: boolean
  api?: AuthAudience
  accessMode?: 'local' | 'authenticated'
  packageBaseUrl?: string
  readyUsers?: number
  delivery?: boolean
  identityConfig?: Partial<Pick<IdentityConfig, 'sessionTtlMs' | 'sessionIdleTtlMs' | 'invitationTtlMs' | 'resetTtlMs' | 'deliveryTimeoutMs' | 'deliveryRetryMs' | 'hashQueueLimit'>>
  apiConfig?: Partial<ApiConfig>
  extraPlugins?: readonly {
    name: string
    plugin: unknown
    config?: unknown
  }[]
}
function override(source: string, values: object): string {
  for (const [key, value] of Object.entries(values)) {
    const entry = '    ' + key + ': ' + JSON.stringify(value)
    const existing = new RegExp('^    ' + key + ':.*$', 'm')
    source = existing.test(source) ? source.replace(existing, () => entry) : source + entry + '\n'
  }
  return source
}
export async function identityHarness(options: IdentityHarnessOptions = {}) {
  const root = options.root ?? await realpath(await mkdtemp(join(tmpdir(), 'arx-auth-fixture-')))
  const state = join(root, 'state'), keyRoot = join(root, 'keys'), content = join(root, 'content'), journal = join(root, 'authority-external')
  const initialize = options.initialize ?? options.root === undefined
  if (initialize) {
    await mkdir(keyRoot, { recursive: true, mode: 0o700 })
    await mkdir(content, { recursive: true, mode: 0o700 })
    await writeFile(join(keyRoot, 'identity.key'), randomBytes(32), { flag: 'wx', mode: 0o600 })
  }
  const paths = { root, state, keyRoot, content, journal, database: join(state, 'identity.sqlite'), key: join(keyRoot, 'identity.key') }
  const template = await readFile(fileURLToPath(new URL('../cordis.yml', import.meta.url)), 'utf8')
  let source = template.replaceAll('__JOURNAL__', JSON.stringify(journal)).replaceAll('__STATE__', JSON.stringify(state))
    .replaceAll('__CONTENT__', JSON.stringify(content)).replaceAll('__DATABASE__', JSON.stringify(paths.database))
    .replaceAll('__KEY__', JSON.stringify(paths.key)).replaceAll('__INITIALIZE__', String(initialize))
  if (options.identityConfig !== undefined)
    source = override(source, options.identityConfig)
  if (options.api !== undefined)
    source += `- name: '@arx-ai/arx-host-webserver'
  config: {host: 127.0.0.1, port: 0${options.accessMode === undefined ? '' : ', accessMode: ' + JSON.stringify(options.accessMode)}}
- name: '@arx-ai/arx-host-web-identity-api'
  config:
    audience: ${options.api}
    origin: !!js "'http://127.0.0.1:' + webServer.port"
    allowInsecureLoopbackFixture: true
    invalidationTimeoutMs: 100
    minimumRecoveryResponseMs: 0
    publicRateLimitAttempts: 100
`
  if (options.apiConfig !== undefined)
    source = override(source, options.apiConfig)
  const config = join(root, 'cordis.yml')
  await writeFile(config, source)
  const ctx = new Context()
  ctx.baseUrl = options.packageBaseUrl ?? pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@arx-ai/arx-identity-authority-journal', Journal], ['@arx-ai/arx-web-identity-sqlite', SqliteIdentity],
    ['@arx-ai/arx-host-webserver', HttpServer], ['@arx-ai/arx-host-web-identity-api', IdentityApi],
    ...(options.extraPlugins ?? []).map(row => [row.name, row.plugin] as const),
  ])
  ctx.loader.internal = { version: 'v2', async import(name: string) {
    if (!modules.has(name))
      throw new Error('unexpected identity Loader import')
    return modules.get(name)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  try {
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    for (const row of options.extraPlugins ?? []) {
      await ctx.loader.create({ name: row.name, config: row.config })
      await ctx.loader.await()
    }
  }
  catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
  const deliveries: IdentityDelivery[] = []
  const unregister = options.delivery === false ? () => { } : ctx.webIdentity.registerDelivery({ async send(mail, signal) {
    if (signal.aborted)
      throw new Error('fixture delivery aborted')
    deliveries.push(mail)
    return { providerId: 'fixture-' + mail.operationId }
  } })
  const password = () => 'Fixture-' + randomBytes(16).toString('hex')
  const passwords = { bootstrap: password(), master: password(), users: [] as string[] }
  let master: RequestAuthority | undefined
  if (options.bootstrap ?? initialize) {
    await ctx.webIdentity.bootstrapMaster(passwords.bootstrap)
    const restricted = await ctx.webIdentity.login('arxadmin', passwords.bootstrap, 'admin')
    const changed = await ctx.webIdentity.changePassword(await ctx.webIdentity.authenticate(restricted.token, 'admin'), passwords.bootstrap, passwords.master)
    master = await ctx.webIdentity.authenticate(changed.token, 'admin')
  }
  const users: {
    userId: WebUserId
    username: string
    password: string
    token: string
    authority: RequestAuthority
  }[] = []
  for (let index = 0; index < (options.readyUsers ?? 0); index++) {
    if (master === undefined)
      throw new Error('fixture master required')
    const name = 'fixture-user-' + String(index)
    const user = await ctx.webIdentity.createUser(master, { username: name, email: name + '@fixture.test' })
    await ctx.webIdentity.flushOutbox()
    const mail = (deliveries.findLast(mail => mail.to === user.email) as IdentityDelivery)
    const userPassword = password()
    passwords.users.push(userPassword)
    await ctx.webIdentity.acceptInvitation((new URLSearchParams(new URL(mail.link).hash.slice(1)).get('invite') as string), userPassword)
    await ctx.webIdentity.setStatus(master, user.userId, 'ACTIVE')
    await ctx.webIdentity.setModules(master, user.userId, ['runtime', 'storage'])
    const login = await ctx.webIdentity.login(name, userPassword, 'user')
    users.push({ userId: user.userId, username: name, password: userPassword, token: login.token, authority: await ctx.webIdentity.authenticate(login.token, 'user') })
  }
  return { ctx, paths, deliveries, passwords, master, users, unregisterDelivery: unregister,
    url: options.api === undefined ? undefined : 'http://127.0.0.1:' + String(ctx.webServer.port),
    async close(remove = options.root === undefined) { unregister(); try {
      await ctx.fiber.dispose()
    }
    finally {
      if (remove)
        await rm(root, { recursive: true, force: true })
    } },
  }
}

/** Private members of the identity API that {@link nextInvalidation} observes. */
interface InvalidationInternals {
  pending: Map<string, Set<unknown>>
  invalidation(response: ServerResponse, authority: RequestAuthority, generation: number): Promise<AuthInvalidation>
}

/**
 * Observes the next invalidation poll that the identity API registers for one auth session, so a test orders its
 * steps against the server's state instead of against elapsed time. Install it before the poll request is sent.
 * A request that the API answers without registering a poll, such as a 429 or a generation mismatch, is ignored.
 * @param ctx - Context of an {@link identityHarness} created with `api`.
 * @param authSessionId - Auth session whose poll is observed.
 * @returns `pending` settles once the poll waits on the server; `settled` settles with the result the server
 * returns for it, including the result of a disconnect.
 */
export function nextInvalidation(ctx: Context, authSessionId: string): { pending: Promise<undefined>; settled: Promise<AuthInvalidation> } {
  const api = ctx.webIdentityApi as unknown as InvalidationInternals
  const original = api.invalidation.bind(api)
  const pending = Promise.withResolvers<undefined>(), settled = Promise.withResolvers<AuthInvalidation>()
  let observed = false
  // The wrapper stays installed after its poll and passes calls through, so observers of other sessions keep working.
  api.invalidation = (response, authority, generation) => {
    const before = api.pending.get(authSessionId)?.size ?? 0
    const result = original(response, authority, generation)
    if (!observed && authority.authSessionId === authSessionId && (api.pending.get(authSessionId)?.size ?? 0) > before) {
      observed = true
      pending.resolve(undefined)
      result.then(settled.resolve, settled.reject)
    }
    return result
  }
  return { pending: pending.promise, settled: settled.promise }
}
