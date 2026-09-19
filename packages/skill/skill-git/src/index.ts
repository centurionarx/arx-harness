/**
 * Revision-pinned Git skill provider and provenance snapshot service.
 * Materialization reads regular Git blobs into a verified immutable cache;
 * repository scripts and checkout hooks are never executed.
 * @module @arx-ai/arx-skill-git
 */

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { safeJoin } from './cache-path.ts'
import type { Context } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import type Schema from '@arx-ai/schemastery'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillProviderObservation,
} from '@arx-ai/arx-skill'
import { FileSystemSkillProvider } from '@arx-ai/arx-skill-filesystem'

const SHA = /^[a-f0-9]{40}$/i
const GITHUB_HTTPS = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/
const GITHUB_SSH = /^(?:ssh:\/\/git@github\.com\/|git@github\.com:)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/
const DEFAULT_MAX_FILES = 64
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024
const MAX_GIT_OUTPUT = 8 * 1024 * 1024

export const name = 'skill-git'
export const inject = ['skills']

/** One exact repository revision and selected discovery roots. */
export interface GitSkillSourceConfig {
  /** Absolute local repository or supported github.com Git URL. */
  readonly repository: string
  /** Exact 40-hex commit materialized for discovery and snapshots. */
  readonly commit: string
  /** Repository-relative directories selected for skill discovery. */
  readonly selectedDirs: string[]
}

/** Git skill sources visible only for one workspace cwd. */
export interface GitSkillProjectConfig {
  /** Canonical workspace directory that receives these skills. */
  readonly cwd: string
  /** Revision-pinned repositories explicitly selected for the workspace. */
  readonly sources: GitSkillSourceConfig[]
}

/** Git skill provider configuration. */
export interface Config {
  /** Unique provider label shown in the skill catalog. */
  readonly providerName?: string
  /** Host directory for verified mirrors and immutable materializations. */
  readonly cacheDir?: string
  /** Maximum regular files accepted in one selected source. */
  readonly maxFiles?: number
  /** Maximum combined blob bytes accepted in one selected source. */
  readonly maxBytes?: number
  /** Workspace-specific pinned skill source selections. */
  readonly projects?: GitSkillProjectConfig[]
}

const sourceConfig = z.object({
  repository: z.string().required(),
  commit: z.string().required(),
  selectedDirs: z.array(z.string()).required(),
})

export const Config: Schema<Config> = z.object({
  providerName: z.string().min(1).default('git'),
  cacheDir: z.string(),
  maxFiles: z.number().step(1).min(1).default(DEFAULT_MAX_FILES),
  maxBytes: z.number().step(1).min(1).default(DEFAULT_MAX_BYTES),
  projects: z.array(z.object({
    cwd: z.string().required(),
    sources: z.array(sourceConfig).required(),
  })).default([]),
})

/** Exact files requested for a prompt source snapshot. */
export interface GitSkillSnapshotRequest {
  readonly repository: string
  readonly commit: string
  readonly paths: readonly string[]
}

/** Immutable source material suitable for a project prompt revision. */
export interface GitSkillSnapshot {
  readonly repository: string
  readonly commit: string
  readonly path: string
  readonly content: string
  readonly contentHash: string
}

interface ResolvedConfig {
  readonly providerName: string
  readonly cacheDir: string
  readonly maxFiles: number
  readonly maxBytes: number
  readonly projects: readonly GitSkillProjectConfig[]
}

interface CachedFile {
  readonly path: string
  readonly bytes: number
  readonly contentHash: string
}

interface CacheManifest {
  readonly version: 1
  readonly repository: string
  readonly commit: string
  readonly selectedPaths: readonly string[]
  readonly files: readonly CachedFile[]
}

interface MaterializedSource {
  readonly root: string
  readonly repository: string
  readonly commit: string
  readonly files: readonly CachedFile[]
}

interface GitTreeEntry {
  readonly mode: string
  readonly object: string
  readonly path: string
}

declare module '@arx-ai/cordis' {
  interface Context {
    skillGit: GitSkillService
  }
}

/** Register the pinned Git provider and its explicit snapshot service. */
export function apply(ctx: Context, config: Config = {}): void {
  const service = new GitSkillService(config)
  ctx.provide('skillGit', service)
  let provider: GitSkillProvider | undefined
  ctx.skills.registerProvider((control) => {
    provider = new GitSkillProvider(ctx, control, service, service.config)
    return provider
  })
  ctx.effect(() => async () => {
    await provider?.dispose()
    await service.dispose()
  }, 'skill-git workers')
}

/** Materializes and verifies exact Git revisions while tracking child lifetime. */
export class GitSkillService {
  /** Validated absolute cache paths and bounded source configuration. */
  readonly config: ResolvedConfig
  private readonly controller = new AbortController()
  private readonly jobs = new Set<Promise<unknown>>()
  private readonly materializations = new Map<string, Promise<MaterializedSource>>()
  private readonly repositories = new Map<string, Promise<string>>()
  private disposal: Promise<void> | undefined

  constructor(config: Config = {}) {
    const maxFiles = config.maxFiles ?? DEFAULT_MAX_FILES
    const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES
    if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) throw new TypeError('skill-git maxFiles must be a positive safe integer')
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('skill-git maxBytes must be a positive safe integer')
    this.config = {
      providerName: config.providerName ?? 'git',
      cacheDir: resolve(config.cacheDir ?? join(homedir(), '.arx', 'skill-git-cache')),
      maxFiles,
      maxBytes,
      projects: (config.projects ?? []).map(project => ({
        cwd: resolve(project.cwd),
        sources: project.sources.map(source => ({
          repository: normalizeRepository(source.repository),
          commit: normalizeCommit(source.commit),
          selectedDirs: normalizePaths(source.selectedDirs),
        })),
      })),
    }
  }

  /**
   * Return exact regular files with repository, commit, path, content, and digest.
   * @param request - Exact repository, 40-hex commit, and selected file paths.
   * @param signal - Optional cancellation for this caller only.
   * @returns Verified immutable source snapshots.
   */
  async snapshot(request: GitSkillSnapshotRequest, signal?: AbortSignal): Promise<readonly GitSkillSnapshot[]> {
    signal?.throwIfAborted()
    const repository = normalizeRepository(request.repository)
    const commit = normalizeCommit(request.commit)
    const paths = normalizePaths(request.paths)
    const materialized = await this.materialize(repository, commit, paths, true, signal)
    const snapshots: GitSkillSnapshot[] = []
    for (const file of materialized.files) {
      signal?.throwIfAborted()
      const content = await readFile(safeJoin(materialized.root, file.path), 'utf8')
      signal?.throwIfAborted()
      snapshots.push({ repository, commit, path: file.path, content, contentHash: file.contentHash })
    }
    return snapshots
  }

  /**
   * Materialize selected discovery directories for the provider.
   * @param source - Exact repository revision and selected directories.
   * @param signal - Optional cancellation for this caller only.
   * @returns Verified cache root and regular-file manifest.
   */
  materializeDirectories(source: GitSkillSourceConfig, signal?: AbortSignal): Promise<MaterializedSource> {
    return this.materialize(
      normalizeRepository(source.repository),
      normalizeCommit(source.commit),
      normalizePaths(source.selectedDirs),
      false,
      signal,
    )
  }

  /** Abort active children and settle every tracked operation. */
  dispose(): Promise<void> {
    this.disposal ??= (async () => {
      this.controller.abort(new Error('skill-git disposed'))
      await Promise.allSettled([...this.jobs])
    })()
    return this.disposal
  }

  private materialize(
    repository: string,
    commit: string,
    selectedPaths: readonly string[],
    exactFiles: boolean,
    signal?: AbortSignal,
  ): Promise<MaterializedSource> {
    if (this.disposal !== undefined) return Promise.reject(new Error('skill-git is disposed'))
    const key = digest(JSON.stringify({ repository, commit, selectedPaths, exactFiles }))
    const existing = this.materializations.get(key)
    if (existing !== undefined) return this.awaitForCaller(existing, signal)
    // Shared cache population belongs to the service lifecycle. One cancelled
    // caller stops waiting without cancelling work used by another caller.
    const operation = this.track(this.materializeFresh(key, repository, commit, selectedPaths, exactFiles))
    this.materializations.set(key, operation)
    void operation.finally(() => { this.materializations.delete(key) }).catch(() => {})
    return this.awaitForCaller(operation, signal)
  }

  private awaitForCaller<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal === undefined) return operation
    signal.throwIfAborted()
    return new Promise<T>((resolve, reject) => {
      const errorOf = (reason: unknown): Error => reason instanceof Error ? reason : new Error('skill-git operation cancelled')
      const aborted = (): void => { reject(errorOf(signal.reason)) }
      signal.addEventListener('abort', aborted, { once: true })
      void operation.then(
        (value) => { signal.removeEventListener('abort', aborted); resolve(value) },
        (error: unknown) => { signal.removeEventListener('abort', aborted); reject(errorOf(error)) },
      )
    })
  }

  private async materializeFresh(
    key: string,
    repository: string,
    commit: string,
    selectedPaths: readonly string[],
    exactFiles: boolean,
  ): Promise<MaterializedSource> {
    const root = safeJoin(this.config.cacheDir, join('materialized', key))
    const cached = await this.readVerifiedCache(root, repository, commit, selectedPaths)
    if (cached !== undefined) {
      if (exactFiles) assertExactFiles(cached.files, selectedPaths)
      return { root, repository, commit, files: cached.files }
    }
    const mirror = await this.ensureRepository(repository)
    let resolved: string
    try {
      resolved = (await this.git(['rev-parse', '--verify', commit + '^{commit}'], mirror)).toString('utf8').trim().toLowerCase()
    } catch {
      await this.git(['fetch', '--no-tags', 'origin', commit], mirror)
      resolved = (await this.git(['rev-parse', '--verify', commit + '^{commit}'], mirror)).toString('utf8').trim().toLowerCase()
    }
    if (resolved !== commit) throw new Error('skill-git requested commit is unavailable')
    const tree = parseTree(await this.git(['ls-tree', '-rz', '--full-tree', commit, '--', ...selectedPaths], mirror))
    if (tree.length === 0) throw new Error('skill-git selected paths contain no files')
    if (exactFiles) assertExactTree(tree, selectedPaths)
    if (tree.length > this.config.maxFiles) throw new Error('skill-git selected file count exceeds configured limit')

    const casePaths = new Set<string>()
    const bodies: { entry: GitTreeEntry; body: Buffer; contentHash: string }[] = []
    let totalBytes = 0
    for (const entry of tree) {
      if (entry.mode !== '100644' && entry.mode !== '100755') {
        throw new Error('skill-git selected paths contain a symlink or non-regular entry')
      }
      const normalized = normalizePath(entry.path)
      const folded = normalized.toLocaleLowerCase('en-US')
      if (casePaths.has(folded)) throw new Error('skill-git selected paths contain a case-colliding file')
      casePaths.add(folded)
      const body = await this.git(['cat-file', 'blob', entry.object], mirror, this.config.maxBytes + 1)
      totalBytes += body.byteLength
      if (totalBytes > this.config.maxBytes) throw new Error('skill-git selected content exceeds configured byte limit')
      bodies.push({ entry: { ...entry, path: normalized }, body, contentHash: 'sha256:' + digest(body) })
    }

    const temporary = safeJoin(this.config.cacheDir, join('materialized', '.tmp-' + key + '-' + randomUUID()))
    await mkdir(temporary, { recursive: true })
    try {
      const files: CachedFile[] = []
      for (const item of bodies) {
        const destination = safeJoin(temporary, item.entry.path)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, item.body, { mode: 0o600 })
        files.push({ path: item.entry.path, bytes: item.body.byteLength, contentHash: item.contentHash })
      }
      const manifest: CacheManifest = { version: 1, repository, commit, selectedPaths, files }
      await writeFile(join(temporary, 'manifest.json'), JSON.stringify(manifest), { encoding: 'utf8', mode: 0o600 })
      await mkdir(dirname(root), { recursive: true })
      await rm(root, { recursive: true, force: true })
      await rename(temporary, root)
      return { root, repository, commit, files }
    } catch (error) {
      await rm(temporary, { recursive: true, force: true })
      throw error
    }
  }

  private async readVerifiedCache(
    root: string,
    repository: string,
    commit: string,
    selectedPaths: readonly string[],
  ): Promise<CacheManifest | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
      const manifest = parsed as Record<string, unknown>
      if (manifest['version'] !== 1 || manifest['repository'] !== repository || manifest['commit'] !== commit
        || !Array.isArray(manifest['selectedPaths'])
        || manifest['selectedPaths'].some(value => typeof value !== 'string')
        || JSON.stringify(manifest['selectedPaths']) !== JSON.stringify(selectedPaths)
        || !Array.isArray(manifest['files']) || manifest['files'].length > this.config.maxFiles) return undefined
      const files: CachedFile[] = []
      let total = 0
      for (const value of manifest['files']) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
        const file = value as Record<string, unknown>
        if (typeof file['path'] !== 'string' || !Number.isSafeInteger(file['bytes'])
          || (file['bytes'] as number) < 0 || typeof file['contentHash'] !== 'string') return undefined
        const path = normalizePath(file['path'])
        const target = safeJoin(root, path)
        const info = await lstat(target)
        if (!info.isFile() || info.isSymbolicLink()) return undefined
        const body = await readFile(target)
        total += body.byteLength
        if (body.byteLength !== file['bytes'] || total > this.config.maxBytes
          || `sha256:${digest(body)}` !== file['contentHash']) return undefined
        files.push({ path, bytes: file['bytes'], contentHash: file['contentHash'] })
      }
      return { version: 1, repository, commit, selectedPaths, files }
    } catch {
      return undefined
    }
  }

  private ensureRepository(repository: string): Promise<string> {
    const key = digest(repository)
    const existing = this.repositories.get(key)
    if (existing !== undefined) return existing
    const operation = this.track(this.ensureRepositoryFresh(repository, key))
    this.repositories.set(key, operation)
    void operation.catch(() => { this.repositories.delete(key) })
    return operation
  }

  private async ensureRepositoryFresh(repository: string, key: string): Promise<string> {
    const mirror = safeJoin(this.config.cacheDir, join('repositories', key + '.git'))
    try {
      await lstat(join(mirror, 'HEAD'))
      return mirror
    } catch {}
    await mkdir(dirname(mirror), { recursive: true })
    await rm(mirror, { recursive: true, force: true })
    try {
      await this.git(['clone', '--mirror', repository, mirror])
    } catch (gitError) {
      if (!isGitHubRepository(repository)) throw gitError
      await rm(mirror, { recursive: true, force: true })
      await this.command('gh', ['repo', 'clone', repository, mirror, '--', '--mirror'])
    }
    return mirror
  }

  private git(args: readonly string[], cwd?: string, maxOutput = MAX_GIT_OUTPUT): Promise<Buffer> {
    return this.command('git', args, cwd, maxOutput)
  }

  private command(
    executable: string,
    args: readonly string[],
    cwd?: string,
    maxOutput = MAX_GIT_OUTPUT,
  ): Promise<Buffer> {
    const signal = this.controller.signal
    return new Promise<Buffer>((resolvePromise, reject) => {
      if (signal.aborted) {
        reject(new Error('skill-git disposed'))
        return
      }
      const child = spawn(executable, [...args], {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal,
      })
      const stdout: Buffer[] = []
      let bytes = 0
      let failure: Error | undefined
      child.stdout.on('data', (chunk: Buffer) => {
        if (failure !== undefined) return
        bytes += chunk.byteLength
        if (bytes > maxOutput) {
          failure = new Error('skill-git command output exceeds configured limit')
          child.kill()
          return
        }
        stdout.push(chunk)
      })
      child.stderr.resume()
      child.once('error', () => { failure ??= new Error('skill-git repository operation failed') })
      child.once('close', (code) => {
        if (failure !== undefined) reject(failure)
        else if (code !== 0) reject(new Error('skill-git repository operation failed'))
        else resolvePromise(Buffer.concat(stdout))
      })
    })
  }

  private track<T>(job: Promise<T>): Promise<T> {
    this.jobs.add(job)
    void job.finally(() => { this.jobs.delete(job) }).catch(() => {})
    return job
  }
}

/** Cwd-routed provider which reuses filesystem parsing over verified cache roots. */
class GitSkillProvider implements SkillProvider {
  readonly name: string
  private readonly loader: FileSystemSkillProvider
  private readonly delegates = new Set<FileSystemSkillProvider>()
  private disposal: Promise<void> | undefined

  constructor(
    private readonly ctx: Context,
    control: SkillProviderControl,
    private readonly service: GitSkillService,
    private readonly config: ResolvedConfig,
  ) {
    this.name = config.providerName
    this.loader = new FileSystemSkillProvider(ctx, control, {
      providerName: this.name,
      includeDefaultRoots: false,
      customSkillDirs: [],
      watch: false,
    })
    control.signal.addEventListener('abort', () => { void this.dispose() }, { once: true })
  }

  async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[] | SkillProviderObservation> {
    if (this.disposal !== undefined) throw new Error('skill-git provider is disposed')
    if (options.cwd === undefined) return []
    const cwd = resolve(options.cwd)
    const project = this.config.projects.find(candidate => candidate.cwd === cwd)
    if (project === undefined) return []
    const roots: string[] = []
    for (const source of project.sources) {
      const materialized = await this.service.materializeDirectories(source, options.signal)
      for (const selectedDir of source.selectedDirs) roots.push(safeJoin(materialized.root, normalizePath(selectedDir)))
    }
    const delegate = new FileSystemSkillProvider(this.ctx, {
      signal: options.signal ?? new AbortController().signal,
      invalidate: () => {},
    }, {
      providerName: this.name,
      includeDefaultRoots: false,
      customSkillDirs: roots,
      watch: false,
    })
    this.delegates.add(delegate)
    try {
      return await delegate.list(options)
    } finally {
      this.delegates.delete(delegate)
      await delegate.dispose()
    }
  }

  get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    return this.loader.get(candidate, options)
  }

  dispose(): Promise<void> {
    this.disposal ??= (async () => {
      await Promise.allSettled([...this.delegates].map(delegate => delegate.dispose()))
      await this.loader.dispose()
    })()
    return this.disposal
  }
}

function normalizeRepository(repository: string): string {
  const value = repository.trim()
  if (isAbsolute(value)) return resolve(value)
  if (GITHUB_HTTPS.test(value) || GITHUB_SSH.test(value)) return value.replace(/\/$/, '')
  throw new TypeError('skill-git repository must be an absolute local path or a github.com HTTPS/SSH repository')
}

function isGitHubRepository(repository: string): boolean {
  return GITHUB_HTTPS.test(repository) || GITHUB_SSH.test(repository)
}

function normalizeCommit(commit: string): string {
  if (!SHA.test(commit)) throw new TypeError('skill-git commit must be an exact 40-hex object id')
  return commit.toLowerCase()
}

function normalizePaths(paths: readonly string[]): string[] {
  if (paths.length === 0) throw new TypeError('skill-git requires at least one selected path')
  return [...new Set(paths.map(normalizePath))].sort((left, right) => left.localeCompare(right))
}

function normalizePath(path: string): string {
  const value = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (value.length === 0 || value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw new TypeError('skill-git selected path must be repository-relative')
  const segments = value.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..' || segment === '.git')) {
    throw new TypeError('skill-git selected path contains a forbidden segment')
  }
  return segments.join('/')
}

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function parseTree(output: Buffer): GitTreeEntry[] {
  const entries: GitTreeEntry[] = []
  for (const record of output.toString('utf8').split('\0')) {
    if (record.length === 0) continue
    const match = /^(\d+) ([^ ]+) ([a-f0-9]+)\t([\s\S]+)$/.exec(record)
    if (match === null || match[2] !== 'blob') throw new Error('skill-git repository tree contains an unsupported entry')
    entries.push({ mode: match[1] as string, object: match[3] as string, path: match[4] as string })
  }
  return entries
}

function assertExactTree(entries: readonly GitTreeEntry[], paths: readonly string[]): void {
  const actual = new Set(entries.map(entry => normalizePath(entry.path)))
  if (actual.size !== paths.length || paths.some(path => !actual.has(path))) {
    throw new Error('skill-git snapshot paths must name exact regular files')
  }
}

function assertExactFiles(files: readonly CachedFile[], paths: readonly string[]): void {
  const actual = new Set(files.map(file => file.path))
  if (actual.size !== paths.length || paths.some(path => !actual.has(path))) {
    throw new Error('skill-git snapshot paths must name exact regular files')
  }
}
