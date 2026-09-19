/** Bounded previews resolved through the actual Agent filesystem and authenticated Remote gateway. */
import { Context, symbols } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import type { Agent } from '@arx-ai/arx-agent'
import type { FileSystem } from '@arx-ai/arx-fs'
import { Remote, TypertRemoteService } from '@arx-ai/arx-typert-protocol'
import { previewFormat } from './formats.ts'
import type { FilePreview } from './types.ts'
export type * from './types.ts'

/** Deployment bound on bytes read before a preview is encoded. */
export interface Config {
  /** Maximum content bytes per preview; defaults to 2 MiB and cannot exceed 16 MiB. */
  maxBytes?: number
}
declare module '@arx-ai/cordis' { interface Context { /** Session-bound document preview service. */ filePreviews: FilePreviewService } }

/** Canonical identity only; filesystem calls retain the Agent-traced provider wrapper. */
function providerIdentity(provider: FileSystem | undefined): FileSystem | undefined {
  return (provider as (FileSystem & { [symbols.original]?: FileSystem }) | undefined)?.[symbols.original] ?? provider
}

/** Read-only host service; it adds no tool or model-visible event. */
export class FilePreviewService extends TypertRemoteService {
  static inject = ['agents']
  static Config: z<Config> = z.object({ maxBytes: z.number().default(2 * 1024 * 1024) })
  private readonly maxBytes: number
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'filePreviews')
    this.maxBytes = config.maxBytes ?? 2 * 1024 * 1024
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > 16 * 1024 * 1024) {
      throw new Error('file-preview maxBytes must be a positive safe integer no greater than 16777216')
    }
  }

  /**
   * Read an allowlisted regular file inside the live Agent's cwd through that
   * Agent's filesystem. Rejects unknown/disposed owners, escaping paths, symlinks,
   * absent files, unsupported types, invalid text, oversized files and cancellation.
   * Reads are bounded by the filesystem provider before buffering; no public URL,
   * persistent copy, session event, or model context is created.
   * @param agent - live session owner supplied by the authenticated gateway.
   * @param path - supported filename resolved inside the session workspace.
   * @param signal - gateway-owned cancellation for the read.
   * @returns current file bytes encoded as bounded UTF-8 text or base64.
   */
  @Remote
  async read(agent: Agent, path: string, signal: AbortSignal): Promise<FilePreview> {
    signal.throwIfAborted()
    const format = typeof path === 'string' ? previewFormat(path) : undefined
    if (format === undefined || path.trim() === '' || path.includes('\0')) throw new Error('File type is not supported for preview')
    const cwd = agent.session.header.cwd
    const provider = agent.ctx.get('fs')
    const active = (): boolean => this.ctx.agents.get(agent.session.id) === agent && providerIdentity(agent.ctx.get('fs')) === providerIdentity(provider)
    if (cwd === undefined || provider === undefined || !active()) throw new Error('File preview is unavailable for this session')
    const root = await provider.resolve(cwd, { signal })
    const target = await provider.resolve(path, { cwd, signal })
    if (!provider.contains(root, target)) throw new Error('Preview path must be inside the session workspace')
    const info = await provider.lstat(path, { cwd }, signal)
    if (info?.type !== 'file') throw new Error('Preview requires an accessible regular file')
    const data = await provider.readBytes(target, signal, this.maxBytes)
    signal.throwIfAborted()
    if (!active()) throw new Error('File preview session changed during the read')
    if (data.byteLength > this.maxBytes) throw new Error('File exceeds the preview byte limit')
    let content: string
    if (format.encoding === 'base64') content = Buffer.from(data).toString('base64')
    else {
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(data) }
      catch { throw new Error('Preview requires valid UTF-8 text') }
      if (content.includes('\0')) throw new Error('Binary content cannot be previewed as text')
    }
    return { path, ...format, content, bytes: data.byteLength }
  }
}
export default FilePreviewService
