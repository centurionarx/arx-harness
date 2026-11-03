/** Real module revocation must precede any project/workspace side effect. */
import { readdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { AUTH_COOKIE_NAMES, AUTH_HEADER, CSRF_HEADER } from '@arx-ai/arx-web-identity/contract'
import { storageHarness } from './harness.ts'

const active: Awaited<ReturnType<typeof storageHarness>>[] = []
afterEach(async () => { for (const f of active.splice(0)) await f.close() })
function rows(path: string, tables: readonly string[]): number[] {
  const database = new DatabaseSync(path, { readOnly: true })
  try { return tables.map(table => Number(database.prepare('SELECT count(*) AS n FROM ' + table).get()!.n)) }
  finally { database.close() }
}
it('denies ungranted USER creation directly and over HTTP without owner, index or volume mutation', async () => {
  const f = await storageHarness({ http: true, readyUsers: 1 }); active.push(f)
  const user = f.users[0]!
  const project = await f.ctx.projectStorage.createProject(user.authority, 'Existing owned project')
  await f.ctx.webIdentity.setModules(f.master!, user.userId, ['runtime'])
  const login = await f.ctx.webIdentity.login(user.username, user.password, 'user')
  const denied = await f.ctx.webIdentity.authenticate(login.token, 'user')
  const headers = { Cookie: AUTH_COOKIE_NAMES.user + '=' + login.token, Origin: f.url!,
    [AUTH_HEADER]: '1', [CSRF_HEADER]: login.state.csrfToken, 'Content-Type': 'application/json' }
  const ownerTables = ['project_owners', 'workspace_owners', 'session_owners']
  const indexTables = ['projects', 'workspaces', 'history']
  const beforeOwners = rows(f.paths.database, ownerTables)
  const beforeIndex = rows(f.index, indexTables)
  const beforeVolumes = await readdir(f.volumeRoot)
  await expect(f.ctx.projectStorage.createProject(denied, 'Blocked project')).rejects.toMatchObject({ status: 403 })
  await expect(f.ctx.projectStorage.projects(denied)).rejects.toMatchObject({ status: 403 })
  await expect(f.ctx.projectStorage.createWorkspace(denied, project.projectId, 'Blocked workspace')).rejects.toMatchObject({ status: 403 })
  expect((await fetch(f.url! + '/user/projects', { method: 'POST', headers, body: '{"name":"Blocked project"}' })).status).toBe(403)
  expect((await fetch(f.url! + '/user/projects', { headers })).status).toBe(403)
  expect((await fetch(f.url! + '/user/projects/' + project.projectId + '/workspaces',
    { method: 'POST', headers, body: '{"name":"Blocked workspace"}' })).status).toBe(403)
  expect(rows(f.paths.database, ownerTables)).toEqual(beforeOwners)
  expect(rows(f.index, indexTables)).toEqual(beforeIndex)
  expect(await readdir(f.volumeRoot)).toEqual(beforeVolumes)
  await f.ctx.webIdentity.setModules(f.master!, user.userId, ['storage'])
  const restored = await f.ctx.webIdentity.login(user.username, user.password, 'user')
  const authority = await f.ctx.webIdentity.authenticate(restored.token, 'user')
  expect((await f.ctx.projectStorage.projects(authority)).projects).toEqual([project])
  const workspace = await f.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Granted workspace')
  expect((await f.ctx.projectStorage.workspaces(authority, project.projectId)).workspaces).toEqual([workspace])
})
