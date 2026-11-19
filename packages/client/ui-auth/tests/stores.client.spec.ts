/** Detached metadata/store lifecycle; these data do not authenticate an owner. */
import { describe, expect, it } from 'vitest'
import { parseAdminUserList, parseModuleCatalog } from '@arx-ai/arx-web-identity/contract'
import { parseProjectsPage, parseWorkspacesPage, parseHistoryPage } from '@arx-ai/arx-project-storage/contract'
import { createAdminStore, createUserBrowserStore } from '../src/client/stores.ts'

describe('native identity stores are private to one tree', () => {
  it('deduplicates admin pages, reports mutation state, and clears all identity metadata', () => {
    const first = createAdminStore().create(), other = createAdminStore().create()
    const userId = crypto.randomUUID()
    const user = { userId, username: 'metadata-user', email: 'metadata@fixture.test',
      role: 'USER', status: 'PENDING', mustChangePassword: false, grants: [], passwordEstablished: false }
    const rows = parseAdminUserList({ users: [user] }).users
    const modules = parseModuleCatalog({ modules: [{ id: 'storage', label: 'Storage', operations: ['own.read'] }] }).modules
    first.actions.loaded(rows, modules, 'page-two', false)
    first.actions.loaded(parseAdminUserList({ users: [{ ...user, status: 'ACTIVE' }] }).users, modules, undefined, true)
    expect(first.store.getSnapshot().users).toHaveLength(1)
    expect(first.store.getSnapshot().users[0]?.status).toBe('ACTIVE')
    expect(other.store.getSnapshot().users).toEqual([])
    first.actions.select('modules')
    first.actions.notify('accepted')
    first.actions.pending(false)
    expect(first.store.getSnapshot().notice).toBe('accepted')
    first.actions.pending(true)
    expect(first.store.getSnapshot()).toMatchObject({ page: 'modules', busy: true, notice: undefined, error: undefined })
    first.actions.fail('FORBIDDEN')
    expect(first.store.getSnapshot()).toMatchObject({ busy: false, error: 'FORBIDDEN' })
    first.actions.notify('userCreated')
    first.actions.clear()
    expect(first.store.getSnapshot()).toMatchObject({ users: [], modules: [], nextCursor: undefined,
      error: undefined, notice: undefined, busy: false })
  })

  it('resets project selection and history pages without crossing independent store instances', () => {
    const first = createUserBrowserStore().create(), other = createUserBrowserStore().create()
    const projectId = crypto.randomUUID(), workspaceId = crypto.randomUUID(), sessionId = crypto.randomUUID()
    const project = { projectId, name: 'Own metadata', createdAt: 1 }
    const workspace = { projectId, workspaceId, name: 'Virtual workspace', createdAt: 2, grouped: true }
    const session = { projectId, workspaceId, sessionId, title: 'Own history', createdAt: 3, nextSeq: 2, grouped: true }
    const projects = parseProjectsPage({ projects: [project] }).projects
    const workspaces = parseWorkspacesPage({ workspaces: [workspace] }).workspaces
    const sessions = parseHistoryPage({ sessions: [session] }).sessions
    first.actions.pending()
    first.actions.projects(projects, 'projects-more', false)
    first.actions.projects(parseProjectsPage({ projects: [{ ...project, name: 'Updated own metadata' }] }).projects, undefined, true)
    expect(first.store.getSnapshot().projects).toHaveLength(1)
    expect(first.store.getSnapshot().projects[0]?.name).toBe('Updated own metadata')
    first.actions.select(projectId)
    first.actions.workspaces(workspaces, 'workspace-more', false)
    first.actions.workspaces(workspaces, undefined, true)
    first.actions.sessions(sessions, 'session-more', false)
    first.actions.sessions(sessions, undefined, true)
    expect(first.store.getSnapshot().workspaces).toHaveLength(1)
    expect(first.store.getSnapshot().sessions).toHaveLength(1)
    const id = sessions[0]!.sessionId
    first.actions.history(id, 'first\n', 'history-more', false)
    first.actions.history(id, 'second\n', undefined, true)
    expect(first.store.getSnapshot().history?.content).toBe('first\nsecond\n')
    const otherId = parseHistoryPage({ sessions: [{ ...session, sessionId: crypto.randomUUID() }] }).sessions[0]!.sessionId
    first.actions.history(otherId, 'different\n', undefined, true)
    expect(first.store.getSnapshot().history?.content).toBe('different\n')
    first.actions.closeHistory()
    first.actions.history(id, 'fresh\n', undefined, true)
    expect(first.store.getSnapshot().history?.content).toBe('fresh\n')
    expect(other.store.getSnapshot().history).toBeUndefined()
    first.actions.select(crypto.randomUUID())
    expect(first.store.getSnapshot()).toMatchObject({ workspaces: [], sessions: [], history: undefined,
      workspaceCursor: undefined, sessionCursor: undefined })
    first.actions.fail('QUOTA_EXCEEDED')
    expect(first.store.getSnapshot()).toMatchObject({ error: 'QUOTA_EXCEEDED', busy: false })
    first.actions.pending()
    expect(first.store.getSnapshot().error).toBeUndefined()
    first.actions.ready()
    first.actions.clear()
    expect(first.store.getSnapshot()).toEqual(other.store.getSnapshot())
  })
})
