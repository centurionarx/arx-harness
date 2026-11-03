import { describe, expect, it } from 'vitest'
import { parseProjectsPage, parseWorkspacesPage, parseHistoryPage, parseHistoryArtifactPage,
  parseCreatedProject, parseCreatedWorkspace } from '../src/contract.ts'

const project = { projectId: '00000000-0000-4000-8000-000000000001', name: 'Owned project', createdAt: 0 }
const workspace = { projectId: project.projectId, workspaceId: '00000000-0000-4000-8000-000000000002',
  name: 'Owned workspace', createdAt: 1, grouped: true }
const session = { projectId: project.projectId, workspaceId: workspace.workspaceId, sessionId: 'owned-log',
  title: 'Original title', createdAt: 1, nextSeq: 0, grouped: false }

describe('untrusted owner HTTP response contracts', () => {
  it('preserves original UTF-8 history text and validates optional continuations', () => {
    expect(parseCreatedProject({ project })).toEqual(project)
    expect(parseCreatedWorkspace({ workspace })).toEqual(workspace)
    expect(parseProjectsPage({ projects: [project], nextCursor: 'opaque-project' }))
      .toEqual({ projects: [project], nextCursor: 'opaque-project' })
    expect(parseWorkspacesPage({ workspaces: [workspace] })).toEqual({ workspaces: [workspace] })
    expect(parseHistoryPage({ sessions: [session], nextCursor: 'opaque-session' }))
      .toEqual({ sessions: [session], nextCursor: 'opaque-session' })
    const page = { sessionId: session.sessionId, nextSeq: 0, content: '{"original":"á🧪"}\n', nextCursor: 'opaque-byte-position' }
    expect(parseHistoryArtifactPage(page)).toEqual(page)
    expect(parseHistoryArtifactPage({ ...page, nextCursor: undefined }))
      .toEqual({ sessionId: session.sessionId, nextSeq: 0, content: page.content })
    expect(parseWorkspacesPage({ workspaces: [], nextCursor: 'next-workspace' }))
      .toEqual({ workspaces: [], nextCursor: 'next-workspace' })
    expect(parseProjectsPage({ projects: [] })).toEqual({ projects: [] })
    expect(parseHistoryPage({ sessions: [] })).toEqual({ sessions: [] })
  })
  it('rejects nonobjects and missing list envelopes instead of treating them as an empty collection', () => {
    for (const value of [undefined, null, false, 1, 'x', []]) {
      for (const parse of [parseProjectsPage, parseWorkspacesPage, parseHistoryPage,
        parseHistoryArtifactPage, parseCreatedProject, parseCreatedWorkspace]) expect(() => parse(value)).toThrow('Invalid project response')
    }
    expect(() => parseProjectsPage({ projects: {} })).toThrow('Invalid project list')
    expect(() => parseWorkspacesPage({ workspaces: null })).toThrow('Invalid workspace list')
    expect(() => parseHistoryPage({ sessions: 'none' })).toThrow('Invalid session list')
    expect(() => parseProjectsPage({ projects: [null] })).toThrow('Invalid project response')
    expect(() => parseWorkspacesPage({ workspaces: [false] })).toThrow('Invalid project response')
    expect(() => parseHistoryPage({ sessions: [[]] })).toThrow('Invalid project response')
  })
  it('rejects malformed fields at the browser transport boundary', () => {
    for (const field of ['projectId', 'name']) expect(() => parseCreatedProject({ project: { ...project, [field]: 1 } })).toThrow('Invalid project text')
    for (const field of ['workspaceId', 'projectId', 'name']) expect(() => parseCreatedWorkspace({ workspace: { ...workspace, [field]: null } })).toThrow('Invalid project text')
    for (const field of ['sessionId', 'workspaceId', 'projectId', 'title']) expect(() => parseHistoryPage({ sessions: [{ ...session, [field]: false }] })).toThrow('Invalid project text')
    for (const value of [undefined, '1', NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseCreatedProject({ project: { ...project, createdAt: value } })).toThrow('Invalid project number')
      expect(() => parseCreatedWorkspace({ workspace: { ...workspace, createdAt: value } })).toThrow('Invalid project number')
      expect(() => parseHistoryPage({ sessions: [{ ...session, nextSeq: value }] })).toThrow('Invalid project number')
      expect(() => parseHistoryArtifactPage({ sessionId: 'owned', nextSeq: value, content: '' })).toThrow('Invalid project number')
    }
    for (const value of [0, 'false', null]) {
      expect(() => parseCreatedWorkspace({ workspace: { ...workspace, grouped: value } })).toThrow('Invalid project flag')
      expect(() => parseHistoryPage({ sessions: [{ ...session, grouped: value }] })).toThrow('Invalid project flag')
    }
    expect(() => parseHistoryArtifactPage({ sessionId: 'owned', nextSeq: 1, content: [] })).toThrow('Invalid project text')
    for (const parse of [parseProjectsPage, parseWorkspacesPage, parseHistoryPage]) {
      expect(() => parse({ projects: [], workspaces: [], sessions: [], nextCursor: 1 })).toThrow('Invalid project text')
    }
  })
})
