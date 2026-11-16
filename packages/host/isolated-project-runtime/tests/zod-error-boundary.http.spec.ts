/** Public formatter failure traverses genuine HTTP, sealed identity and canonical payload parsing. */
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, afterAll, beforeAll } from 'vitest'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { RpcId } from '@arx-ai/arx-host-apiproxy/api'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity'
import * as Connection from '../../../client/connection/src/index.ts'
import { storageHarness } from '../../../identity/project-storage/tests/harness.ts'
import { supervisorFixture } from './supervisor.ts'

// Identity bootstrap hashes several passwords, so it runs once; every test opens its own copy of that root.
const seed = { root: '', users: [] as Awaited<ReturnType<typeof storageHarness>>['users'], master: '',
  passwords: {} as Awaited<ReturnType<typeof storageHarness>>['passwords'] }
beforeAll(async () => {
  const harness = await storageHarness({ readyUsers: 1 })
  try {
    seed.root = harness.paths.root
    seed.users = harness.users
    seed.passwords = harness.passwords
    seed.master = (await harness.ctx.webIdentity.login('arxadmin', harness.passwords.master, 'admin')).token
  } finally { await harness.close(false) }
})
afterAll(() => rm(seed.root, { recursive: true, force: true }))
async function seededHarness(options: Omit<Parameters<typeof storageHarness>[0] & object, 'root' | 'readyUsers' | 'initialize'> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arx-project-fixture-'))
  const remove = () => rm(root, { recursive: true, force: true })
  const harness = await cp(seed.root, root, { recursive: true }).then(() => storageHarness({ ...options, root }))
    .catch(async (error: unknown) => { await remove(); throw error })
  try {
    const users = await Promise.all(seed.users.map(async user => ({ ...user,
      authority: await harness.ctx.webIdentity.authenticate(user.token, 'user') })))
    return { ...harness, users, passwords: seed.passwords,
      master: await harness.ctx.webIdentity.authenticate(seed.master, 'admin'),
      async close() { await harness.close(false); await remove() } }
  } catch (error) { await harness.close(false); await remove(); throw error }
}

const resources: { close(): Promise<void> }[] = []
afterEach(async () => { for (const item of resources.splice(0).reverse()) await item.close() })

describe('canonical payload error formatter at the actual authenticated HTTP boundary', () => {
  it('retains a safe bad-request receipt when the public formatter fails and restores its exact configuration', async () => {
    const supervisor = await supervisorFixture()
    resources.push(supervisor)
    const fixture = await seededHarness({ http: true, endpoint: supervisor.endpoint,
      extraPlugins: [{ name: '@arx-ai/arx-client-connection', plugin: Connection,
        config: { accessMode: 'authenticated' } }] })
    resources.push(fixture)
    const user = fixture.users[0]
    const origin = fixture.url
    if (user === undefined || origin === undefined) throw new Error('Real authenticated HTTP fixture missing')
    const state = await fixture.ctx.webIdentity.state(user.authority)
    const ownerDatabase = new DatabaseSync(fixture.paths.database, { readOnly: true })
    const configuration = z.config()
    const originalDescriptor = Object.getOwnPropertyDescriptor(configuration, 'customError')
    let formatterCalls = 0
    try {
      expect(ownerDatabase.prepare('SELECT COUNT(*) AS total FROM session_owners').get()?.total).toBe(0)
      z.config({ customError: () => { formatterCalls++; throw new Error('Keyless formatter failure') } })
      const response = await fetch(origin + '/api/session.create', { method: 'POST',
        headers: { 'content-type': 'application/json', origin, [AUTH_HEADER]: '1',
          [CSRF_HEADER]: state.csrfToken, cookie: AUTH_COOKIE_NAMES.user + '=' + user.token },
        body: JSON.stringify({ type: 'client-request', rpcId: RpcId(randomUUID()), method: 'session.create',
          payload: { workspaceId: 17 } }) })
      expect(response.status).toBe(200)
      const body = await response.text()
      expect(JSON.parse(body)).toMatchObject({ result: { ok: false, error: {
        code: 'bad-request', message: 'invalid payload for session.create', details: { issues: [] } } } })
      expect(body).not.toContain('Keyless formatter failure')
      expect(formatterCalls).toBe(1)
      expect(supervisor.accepted).toHaveLength(0)
      expect(supervisor.operations.size).toBe(0)
      expect(ownerDatabase.prepare('SELECT COUNT(*) AS total FROM session_owners').get()?.total).toBe(0)
    } finally {
      if (originalDescriptor === undefined) delete configuration.customError
      else Object.defineProperty(configuration, 'customError', originalDescriptor)
      ownerDatabase.close()
    }
    expect(z.config()).toBe(configuration)
    expect(Object.getOwnPropertyDescriptor(z.config(), 'customError')).toEqual(originalDescriptor)
    expect(await fixture.ctx.webIdentity.revalidate(user.authority)).toBe(user.authority)
  })
})
