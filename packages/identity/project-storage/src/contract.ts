/**
 * Browser-safe ownership and history data, never filesystem paths or authority.
 * @module @arx-ai/arx-project-storage/contract
 */
import type { SessionId } from '@arx-ai/arx-session/types'
import type { WorkspaceId } from '@arx-ai/arx-workspace/types'
import { ProjectId } from '@arx-ai/arx-web-identity/contract'
import type { ProjectId as ProjectIdBrand } from '@arx-ai/arx-web-identity/contract'

/** A USER project created with an opaque server id. */
export interface ProjectSummary {
  readonly projectId: ProjectIdBrand
  readonly name: string
  readonly createdAt: number
}
/** Grouping metadata never decides directory or session deletion. */
export interface UserWorkspaceSummary {
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectIdBrand
  readonly name: string
  readonly createdAt: number
  readonly grouped: boolean
}
/** An indexed session contains no model output or host filesystem path. */
export interface StoredSessionSummary {
  readonly sessionId: SessionId
  readonly projectId: ProjectIdBrand
  readonly workspaceId: WorkspaceId
  readonly createdAt: number
  readonly nextSeq: number
  readonly title: string
  readonly grouped: boolean
}
/** Owner-authorized project metadata. */
export interface ProjectsPage { readonly projects: readonly ProjectSummary[]; readonly nextCursor?: string }
/** Owner-authorized workspace metadata. */
export interface WorkspacesPage { readonly workspaces: readonly UserWorkspaceSummary[]; readonly nextCursor?: string }
/** Pagination always applies to owner-authorized metadata. */
export interface HistoryPage { readonly sessions: readonly StoredSessionSummary[]; readonly nextCursor?: string }
/** Successful append acknowledges both durable log and derived index. */
export interface HistoryCommit { readonly sessionId: SessionId; readonly nextSeq: number }
/** UTF-8 cursor positions address the unchanged decoded raw artifact. */
export interface HistoryArtifactPage {
  readonly sessionId: SessionId
  readonly nextSeq: number
  readonly content: string
  readonly nextCursor?: string
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid project response')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid project text')
  return value
}
function natural(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid project number')
  return value
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid project flag')
  return value
}
function optionalCursor(row: Record<string, unknown>): { readonly nextCursor?: string } {
  return row.nextCursor === undefined ? {} : { nextCursor: text(row.nextCursor) }
}
function project(value: unknown): ProjectSummary {
  const row = object(value)
  return { projectId: ProjectId(text(row.projectId)), name: text(row.name), createdAt: natural(row.createdAt) }
}
function workspace(value: unknown): UserWorkspaceSummary {
  const row = object(value)
  return { workspaceId: ProjectId(text(row.workspaceId)) as unknown as WorkspaceId,
    projectId: ProjectId(text(row.projectId)), name: text(row.name), createdAt: natural(row.createdAt), grouped: bool(row.grouped) }
}
function session(value: unknown): StoredSessionSummary {
  const row = object(value)
  return { sessionId: text(row.sessionId) as SessionId, projectId: ProjectId(text(row.projectId)),
    workspaceId: ProjectId(text(row.workspaceId)) as unknown as WorkspaceId,
    createdAt: natural(row.createdAt), nextSeq: natural(row.nextSeq), title: text(row.title), grouped: bool(row.grouped) }
}
/**
 * Parse owner project metadata from HTTP.
 * @param value - Untrusted JSON response.
 * @returns Validated project page.
 */
export function parseProjectsPage(value: unknown): ProjectsPage {
  const row = object(value)
  if (!Array.isArray(row.projects)) throw new Error('Invalid project list')
  return { projects: row.projects.map(project), ...optionalCursor(row) }
}
/**
 * Parse owner workspace metadata from HTTP.
 * @param value - Untrusted JSON response.
 * @returns Validated workspace page.
 */
export function parseWorkspacesPage(value: unknown): WorkspacesPage {
  const row = object(value)
  if (!Array.isArray(row.workspaces)) throw new Error('Invalid workspace list')
  return { workspaces: row.workspaces.map(workspace), ...optionalCursor(row) }
}
/**
 * Parse owner history metadata from HTTP.
 * @param value - Untrusted JSON response.
 * @returns Validated session page.
 */
export function parseHistoryPage(value: unknown): HistoryPage {
  const row = object(value)
  if (!Array.isArray(row.sessions)) throw new Error('Invalid session list')
  return { sessions: row.sessions.map(session), ...optionalCursor(row) }
}
/**
 * Parse a decoded JSONL page without interpreting model/tool output.
 * @param value - Untrusted JSON response.
 * @returns Validated raw-history page.
 */
export function parseHistoryArtifactPage(value: unknown): HistoryArtifactPage {
  const row = object(value)
  return { sessionId: text(row.sessionId) as SessionId, nextSeq: natural(row.nextSeq), content: text(row.content), ...optionalCursor(row) }
}
/**
 * Parse the response to project creation.
 * @param value - Untrusted JSON response.
 * @returns Validated project.
 */
export function parseCreatedProject(value: unknown): ProjectSummary { return project(object(value).project) }
/**
 * Parse the response to workspace creation.
 * @param value - Untrusted JSON response.
 * @returns Validated workspace.
 */
export function parseCreatedWorkspace(value: unknown): UserWorkspaceSummary { return workspace(object(value).workspace) }
