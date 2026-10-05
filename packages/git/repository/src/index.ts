/** Host-only, read-only Git repository BFF; no Agent, shell, network, or transcript events. */
import { devNull } from 'node:os'
import { opendir } from 'node:fs/promises'
import { join } from 'node:path'
import { isAbsolute, posix, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { Context } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import { z as schema } from 'zod'
import { LocalFileSystem } from '@arx-ai/arx-fs-local'
import { FsError, type FsTarget } from '@arx-ai/arx-fs'
import { LocalSubprocessRuntime } from '@arx-ai/arx-subprocess-local'
import { WorkspaceId } from '@arx-ai/arx-workspace'
import { Remote, TypertRemoteService } from '@arx-ai/arx-typert-protocol'
import { parsePorcelain } from './porcelain.ts'
import type { RepositoryDiff, RepositoryDiffRequest, RepositoryInspection, RepositoryRemote, RepositoryRequest, RepositoryStatus } from './types.ts'
export type * from './types.ts'

/** Finite deployment bounds, applied to complete process streams and encoded results. */
export interface Config {
  /** Maximum bytes per complete command output and JSON response; default 2 MiB, ceiling 16 MiB. */
  maxBytes?: number
  /** Maximum config/status/remote records and attribute inventory paths; default 10000, ceiling 100000. */
  maxItems?: number
  /** Whole-request deadline in milliseconds; default 10000, ceiling 120000. */
  timeoutMs?: number
  /** Managed process termination grace in milliseconds; default 250, ceiling 10000. */
  graceMs?: number
  /** Maximum metadata entries scanned before Git; default 100000, ceiling 1000000. */
  maxMetadataItems?: number
  /** Maximum cumulative metadata path/content bytes checked before Git; default 16 MiB, ceiling 64 MiB. */
  maxMetadataBytes?: number
}

declare module '@arx-ai/cordis' {
  interface Context { /** Host workspace Git inspection service. */ repository: RepositoryService }
}

const requestSchema = schema.object({ workspaceId: schema.string().min(1).max(128) }).strict()
const diffSchema = requestSchema.extend({ path: schema.string().min(1), side: schema.enum(['staged', 'unstaged', 'untracked']) })

interface Operation { signal: AbortSignal; abort: (message: string) => void }
interface Repository { fs: LocalFileSystem; workspace: FsTarget; root: FsTarget; cwd: string }

/** Read-only host Git operations; errors contain stable codes, never raw Git diagnostics or URLs. */
export class RepositoryService extends TypertRemoteService {
  static inject = ['fs', 'subprocess', 'workspaceRegistry']
  static Config: z<Config> = z.object({
    maxBytes: z.number().default(2 * 1024 * 1024), maxItems: z.number().default(10000),
    timeoutMs: z.number().default(10000), graceMs: z.number().default(250),
    maxMetadataItems: z.number().default(100000), maxMetadataBytes: z.number().default(16 * 1024 * 1024),
  })
  private readonly limits: Required<Config>
  private readonly disposal = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'repository')
    this.limits = { maxBytes: config.maxBytes ?? 2 * 1024 * 1024, maxItems: config.maxItems ?? 10000,
      timeoutMs: config.timeoutMs ?? 10000, graceMs: config.graceMs ?? 250,
      maxMetadataItems: config.maxMetadataItems ?? 100000, maxMetadataBytes: config.maxMetadataBytes ?? 16 * 1024 * 1024 }
    const ceilings = { maxBytes: 16 * 1024 * 1024, maxItems: 100000, timeoutMs: 120000, graceMs: 10000,
      maxMetadataItems: 1000000, maxMetadataBytes: 64 * 1024 * 1024 }
    for (const key of Object.keys(ceilings) as (keyof Config)[]) {
      if (!Number.isSafeInteger(this.limits[key]) || this.limits[key] < 1 || this.limits[key] > ceilings[key]) {
        throw new Error('REPOSITORY_INVALID_CONFIG: ' + key)
      }
    }
    this.hostProviders()
    ctx.effect(() => async () => {
      this.disposal.abort(new Error('REPOSITORY_DISPOSED'))
      await Promise.allSettled(this.pending)
    }, 'repository request quiescence')
  }

  /**
   * Inspect current host repository identity and credential-free remote identities.
   * @param request - Registered workspace id; repositories above that workspace are refused.
   * @param signal - Gateway-owned request cancellation; no Agent is required.
   * @returns Root, branch, head, local ahead/behind counts and sanitized remote identities.
   */
  @Remote
  inspect(request: RepositoryRequest, signal: AbortSignal): Promise<RepositoryInspection> {
    return this.operation(signal, async (op) => {
      const repo = await this.repository(request, op)
      const parsed = parsePorcelain(await this.statusText(repo, op), this.limits.maxItems)
      const output = await this.git(repo.cwd, ['config', '--no-includes', '--null', '--get-regexp', '^remote\\..*\\.url$'], op, [0, 1])
      const remotes: RepositoryRemote[] = []
      if (output.text && !output.text.endsWith('\0')) throw new Error('REPOSITORY_INVALID_REMOTES')
      for (const record of output.text.split('\0').filter(Boolean)) {
        const newline = record.indexOf('\n')
        const match = /^remote\.(.*)\.url$/.exec(record.slice(0, newline))
        if (newline < 0 || !match) throw new Error('REPOSITORY_INVALID_REMOTES')
        if (remotes.length >= this.limits.maxItems) throw new Error('REPOSITORY_ITEM_LIMIT')
        const raw = record.slice(newline + 1)
        let host: string | null = null, transport: string | null = null
        try {
          const url = new URL(raw)
          if (['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) {
            host = url.hostname
            transport = url.protocol.slice(0, -1)
          }
        } catch {
          // Git also accepts SCP-style and local paths; neither is exposed as a raw URL.
          const scp = /^(?:[^/@:\s]+@)?([a-zA-Z0-9.-]+):[^\r\n]+$/.exec(raw)
          if (scp && !/^[a-zA-Z]:[\\/]/.test(raw)) { host = scp[1] ?? null; transport = 'ssh' }
        }
        remotes.push({ name: match[1] ?? '', host, transport })
      }
      return { root: repo.cwd, branch: parsed.branch, head: parsed.head, aheadBehind: parsed.aheadBehind, remotes }
    })
  }

  /**
   * Read complete porcelain-v2 status, never a truncated stream tail.
   * @param request - Registered host workspace selection.
   * @param signal - Gateway-owned request cancellation.
   * @returns Independent staged, unstaged, untracked and unmerged groups.
   */
  @Remote
  status(request: RepositoryRequest, signal: AbortSignal): Promise<RepositoryStatus> {
    return this.operation(signal, async (op) => {
      const repo = await this.repository(request, op)
      return parsePorcelain(await this.statusText(repo, op), this.limits.maxItems).status
    })
  }

  /**
   * Compare one current status entry; symlinks, escaping paths, conflicts and submodules are refused.
   * @param request - Workspace id, repository-relative status path and independent comparison side.
   * @param signal - Gateway-owned request cancellation.
   * @returns Complete bounded unified text, or binary metadata without blob content.
   */
  @Remote
  diff(request: RepositoryDiffRequest, signal: AbortSignal): Promise<RepositoryDiff> {
    return this.operation(signal, async (op) => {
      const input = diffSchema.safeParse(request)
      if (!input.success) throw new Error('REPOSITORY_INVALID_REQUEST')
      const repo = await this.repository({ workspaceId: WorkspaceId(input.data.workspaceId) }, op)
      await this.path(repo, input.data.path, op)
      const status = parsePorcelain(await this.statusText(repo, op), this.limits.maxItems).status
      if (status.unmerged.some(entry => entry.path === input.data.path)) throw new Error('REPOSITORY_UNSUPPORTED_CONFLICT')
      const entry = status[input.data.side].find(entry => entry.path === input.data.path)
      if (!entry) throw new Error('REPOSITORY_STATUS_CHANGED')
      if (entry.submodule !== 'N...') throw new Error('REPOSITORY_UNSUPPORTED_SUBMODULE')
      const paths = [input.data.path]
      if (entry.originalPath !== undefined) { await this.path(repo, entry.originalPath, op); paths.push(entry.originalPath) }
      const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--unified=3', '--ignore-submodules=all']
      if (input.data.side === 'staged') args.push('--cached')
      if (input.data.side === 'untracked') args.push('--no-index', '--', devNull, './' + input.data.path)
      else args.push('--', ...paths.map(path => './' + path))
      const output = await this.git(repo.cwd, args, op, input.data.side === 'untracked' ? [0, 1] : [0])
      const binary = /^Binary files .* differ$/m.test(output.text)
      return { path: input.data.path, side: input.data.side, binary, text: binary ? '' : output.text }
    })
  }

  private hostProviders(): { fs: LocalFileSystem; subprocess: LocalSubprocessRuntime } {
    const fs = this.ctx.fs, subprocess = this.ctx.subprocess
    if (!(fs instanceof LocalFileSystem) || !(subprocess instanceof LocalSubprocessRuntime)) throw new Error('REPOSITORY_UNSUPPORTED_PROVIDER')
    return { fs, subprocess }
  }

  private operation<T>(signal: AbortSignal, work: (op: Operation) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const combined = AbortSignal.any([signal, controller.signal, this.disposal.signal])
    const abort = (message: string): void =>{  controller.abort(new Error(message)) }
    const timer = setTimeout(() =>{  abort('REPOSITORY_TIMEOUT') }, this.limits.timeoutMs)
    const promise = (async () => {
      try {
        combined.throwIfAborted()
        this.hostProviders()
        const result = await work({ signal: combined, abort })
        combined.throwIfAborted()
        this.hostProviders()
        if (Buffer.byteLength(JSON.stringify(result), 'utf8') > this.limits.maxBytes) throw new Error('REPOSITORY_BYTE_LIMIT')
        return result
      } catch (error: unknown) {
        if (controller.signal.aborted) throw controller.signal.reason
        if (this.disposal.signal.aborted) throw new Error('REPOSITORY_DISPOSED')
        if (signal.aborted) throw new Error('REPOSITORY_CANCELLED')
        if (error instanceof Error && /^REPOSITORY_[A-Z_]+(?:: [a-zA-Z]+)?$/.test(error.message)) throw error
        throw new Error('REPOSITORY_IO_FAILED')
      }
    })()
    this.pending.add(promise)
    void promise.finally(() => { clearTimeout(timer); this.pending.delete(promise) }).catch(() => {
      // The returned promise owns the request failure; cleanup does not create a second rejection.
    })
    return promise
  }

  private async repository(request: RepositoryRequest, op: Operation): Promise<Repository> {
    const input = requestSchema.safeParse(request)
    if (!input.success) throw new Error('REPOSITORY_INVALID_REQUEST')
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(input.data.workspaceId))
    if (!workspace) throw new Error('REPOSITORY_UNKNOWN_WORKSPACE')
    const { fs } = this.hostProviders()
    const target = await fs.resolve(workspace.path, { signal: op.signal })
    if (fs.processPath(target) !== workspace.path || (await fs.stat(target, op.signal))?.type !== 'directory') throw new Error('REPOSITORY_WORKSPACE_UNAVAILABLE')
    const cwd = workspace.path
    const metadata = await fs.lstat('.git', { cwd }, op.signal)
    if (!metadata) throw new Error('REPOSITORY_NOT_FOUND')
    if (metadata.type !== 'directory') throw new Error('REPOSITORY_UNSUPPORTED_WORKTREE')
    const root = target
    await this.metadata(fs, root, cwd, op)
    const config = await this.git(cwd, ['config', '--file', join(cwd, '.git', 'config'), '--no-includes', '--null', '--list'], op)
    if (config.text !== '' && !config.text.endsWith('\0')) throw new Error('REPOSITORY_INVALID_CONFIG_OUTPUT')
    const records = config.text.split('\0').filter(Boolean)
    if (records.length > this.limits.maxItems) throw new Error('REPOSITORY_ITEM_LIMIT')
    for (const record of records) {
      const newline = record.indexOf('\n')
      const key = (newline < 0 ? record : record.slice(0, newline)).toLowerCase()
      const value = newline < 0 ? '' : record.slice(newline + 1)
      if (key === 'include.path' || (key.startsWith('includeif.') && key.endsWith('.path'))) {
        throw new Error('REPOSITORY_UNSUPPORTED_INCLUDES')
      }
      if (/^filter\..*\.(clean|process)$/.test(key) && value !== '') throw new Error('REPOSITORY_UNSUPPORTED_FILTERS')
      if (key === 'extensions.partialclone' || /^remote\..*\.promisor$/.test(key)) throw new Error('REPOSITORY_UNSUPPORTED_PARTIAL_CLONE')
      if (key === 'core.worktree' || key === 'extensions.worktreeconfig') throw new Error('REPOSITORY_UNSUPPORTED_WORKTREE')
    }
    const top = await this.git(cwd, ['rev-parse', '--show-toplevel'], op, [0, 128])
    if (top.exitCode !== 0) throw new Error('REPOSITORY_NOT_FOUND')
    if (this.line(top.text) !== cwd) throw new Error('REPOSITORY_OUTSIDE_WORKSPACE')
    const repo = { fs, workspace: target, root, cwd }
    await this.attributes(repo, op)
    op.signal.throwIfAborted()
    return repo
  }

  private async metadata(fs: LocalFileSystem, workspace: FsTarget, cwd: string, op: Operation): Promise<void> {
    const directories = [join(cwd, '.git')]
    let items = 0, bytes = 0
    while (directories.length) {
      op.signal.throwIfAborted()
      const directory = directories.pop()
      if (directory === undefined) break
      // listDir buffers all children and follows links; host-only opendir streams names, then ctx.fs checks each path.
      const entries = await opendir(directory, { bufferSize: 1 })
      for await (const entry of entries) {
        op.signal.throwIfAborted()
        const path = join(directory, entry.name)
        if (++items > this.limits.maxMetadataItems) throw new Error('REPOSITORY_METADATA_ITEM_LIMIT')
        bytes += Buffer.byteLength(path, 'utf8')
        if (bytes > this.limits.maxMetadataBytes) throw new Error('REPOSITORY_METADATA_BYTE_LIMIT')
        const info = await fs.lstat(path, undefined, op.signal)
        if (!info || (info.type !== 'file' && info.type !== 'directory')) throw new Error('REPOSITORY_UNSUPPORTED_METADATA')
        const target = await fs.resolve(path, { signal: op.signal })
        if (!fs.contains(workspace, target) || fs.processPath(target) !== path) throw new Error('REPOSITORY_UNSUPPORTED_METADATA')
        const metadataPath = path.slice(join(cwd, '.git').length + 1).split(sep).join('/').toLowerCase()
        if (['commondir', 'objects/info/alternates', 'objects/info/http-alternates', 'config.worktree'].includes(metadataPath)) {
          throw new Error('REPOSITORY_UNSUPPORTED_METADATA')
        }
        if (metadataPath.startsWith('objects/pack/') && metadataPath.endsWith('.promisor')) {
          throw new Error('REPOSITORY_UNSUPPORTED_PARTIAL_CLONE')
        }
        if (info.type === 'directory') directories.push(path)
        else if (path === join(cwd, '.git', 'HEAD') || path.startsWith(join(cwd, '.git', 'refs') + sep)) {
          let content: Uint8Array
          try { content = await fs.readBytes(target, op.signal, this.limits.maxMetadataBytes - bytes) }
          catch (error: unknown) {
            if (error instanceof FsError && error.code === 'FS_TOO_LARGE') throw new Error('REPOSITORY_METADATA_BYTE_LIMIT')
            throw error
          }
          bytes += content.byteLength
          let reference: string
          try { reference = new TextDecoder('utf-8', { fatal: true }).decode(content).replace(/\r?\n$/, '') }
          catch { throw new Error('REPOSITORY_UNSUPPORTED_METADATA') }
          if (reference.startsWith('ref: ')) {
            const name = reference.slice(5)
            if (!name.startsWith('refs/') || /[\\\0\r\n:]/.test(name)
              || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('REPOSITORY_UNSUPPORTED_METADATA')
          } else if (!/^[a-f0-9]{40,64}$/.test(reference)) throw new Error('REPOSITORY_UNSUPPORTED_METADATA')
        }
      }
    }
    for (const name of ['HEAD', 'config']) {
      if ((await fs.lstat(join(cwd, '.git', name), undefined, op.signal))?.type !== 'file') throw new Error('REPOSITORY_NOT_FOUND')
    }
  }

  private line(text: string): string {
    if (!text.endsWith('\n') || !text.slice(0, -1)) throw new Error('REPOSITORY_INVALID_OUTPUT')
    return text.slice(0, -1)
  }

  private async attributes(repo: Repository, op: Operation): Promise<void> {
    const output = await this.git(repo.cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], op)
    if (output.text !== '' && !output.text.endsWith('\0')) throw new Error('REPOSITORY_INVALID_OUTPUT')
    const paths = output.text.split('\0').filter(Boolean)
    if (paths.length > this.limits.maxItems) throw new Error('REPOSITORY_ITEM_LIMIT')
    for (const path of paths) await this.path(repo, path, op, true)
    for (const cached of [false, true]) {
      const args = ['check-attr', '-z', '--stdin', ...(cached ? ['--cached'] : []), 'filter']
      const attributes = await this.git(repo.cwd, args, op, [0], output.text)
      if (attributes.text !== '' && !attributes.text.endsWith('\0')) throw new Error('REPOSITORY_INVALID_OUTPUT')
      const records = attributes.text.split('\0')
      records.pop()
      if (records.length !== paths.length * 3) throw new Error('REPOSITORY_INVALID_OUTPUT')
      for (let index = 0; index < records.length; index += 3) {
        if (records[index] !== paths[index / 3] || records[index + 1] !== 'filter') throw new Error('REPOSITORY_INVALID_OUTPUT')
        if (records[index + 2] !== 'unspecified' && records[index + 2] !== 'unset') throw new Error('REPOSITORY_UNSUPPORTED_FILTERS')
      }
    }
  }

  private async path(repo: Repository, path: string, op: Operation, parentsOnly = false): Promise<void> {
    if (!path || path.includes('\0') || isAbsolute(path) || posix.isAbsolute(path) || (sep === '\\' && path.includes('\\'))
      || /^[a-zA-Z]:/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new Error('REPOSITORY_INVALID_PATH')
    let prefix = ''
    const parts = path.split('/')
    for (const part of parentsOnly ? parts.slice(0, -1) : parts) {
      prefix = prefix ? prefix + '/' + part : part
      const info = await repo.fs.lstat(prefix, { cwd: repo.cwd }, op.signal)
      if (info?.type === 'symlink' || (info && info.type !== 'file' && info.type !== 'directory')) throw new Error('REPOSITORY_UNSUPPORTED_PATH')
    }
    const target = await repo.fs.resolve(parentsOnly ? prefix || repo.cwd : path, { cwd: repo.cwd, signal: op.signal })
    if (!repo.fs.contains(repo.root, target) || !repo.fs.contains(repo.workspace, target)) throw new Error('REPOSITORY_INVALID_PATH')
  }

  private statusText(repo: Repository, op: Operation): Promise<string> {
    return this.git(repo.cwd, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignore-submodules=all'], op).then(output => output.text)
  }

  private async git(
    cwd: string, args: string[], op: Operation, accepted: number[] = [0], input?: string,
  ): Promise<{ text: string; exitCode: number }> {
    op.signal.throwIfAborted()
    const { subprocess } = this.hostProviders()
    const env: NodeJS.ProcessEnv = {}
    for (const key of Object.keys(process.env)) if (/^(GIT_|SSH_|GCM_|ASKPASS|DISPLAY)/i.test(key)) env[key] = undefined
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: devNull, GIT_CONFIG_GLOBAL: devNull,
      GIT_DIR: join(cwd, '.git'), GIT_WORK_TREE: cwd })
    Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_OPTIONAL_LOCKS: '0',
      GIT_NO_LAZY_FETCH: '1', GIT_ATTR_NOSYSTEM: '1', GIT_LITERAL_PATHSPECS: '1', LC_ALL: 'C' })
    let executable: string
    try { executable = await subprocess.resolveExecutable('git', undefined, op.signal) }
    catch { op.signal.throwIfAborted(); throw new Error('REPOSITORY_GIT_UNAVAILABLE') }
    const handle = subprocess.spawn({ argv: [executable, '--no-pager', '--no-optional-locks',
      '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.hooksPath=' + devNull,
      '-c', 'core.pager=', '-c', 'core.attributesFile=', '-c', 'core.excludesFile=',
      '-c', 'submodule.recurse=false', '-c', 'diff.submodule=short', '-c', 'credential.interactive=false',
      '-c', 'diff.external=', '-c', 'diff.trustExitCode=false', ...args], cwd, env,
    graceMs: this.limits.graceMs, signal: op.signal, stdio: { stdin: input === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe' } })
    const written = input === undefined ? Promise.resolve() : new Promise<void>((resolve, reject) => {
      if (!handle.stdin) { reject(new Error('REPOSITORY_PROCESS_FAILED')); return }
      handle.stdin.once('error', reject)
      handle.stdin.end(input, 'utf8', resolve)
    })
    let bytes = 0
    const consume = async (stream: Readable | undefined, retain: boolean): Promise<Buffer> => {
      if (!stream) throw new Error('REPOSITORY_PROCESS_FAILED')
      const chunks: Buffer[] = []
      for await (const chunk of stream) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
        bytes += data.length
        if (bytes > this.limits.maxBytes) op.abort('REPOSITORY_BYTE_LIMIT')
        if (!op.signal.aborted && retain) chunks.push(data)
      }
      return Buffer.concat(chunks)
    }
    try {
      const [outcome, stdout] = await Promise.all([handle.done, consume(handle.stdout, true), consume(handle.stderr, false), written])
      op.signal.throwIfAborted()
      if (handle.pid < 0 || outcome.signal !== null || outcome.exitCode === null || !accepted.includes(outcome.exitCode)) throw new Error('REPOSITORY_PROCESS_FAILED')
      let text: string
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(stdout) }
      catch { throw new Error('REPOSITORY_UNSUPPORTED_ENCODING') }
      return { text, exitCode: outcome.exitCode }
    } finally {
      handle.terminate()
      await handle.done.catch(() => {
        // Spawn failures are reported as sanitized request failures, never raw diagnostics.
      })
      await handle.waitForExit()
    }
  }
}
export default RepositoryService
