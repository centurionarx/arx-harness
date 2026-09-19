/**
 * Declare existing files through the configured filesystem and publish only accepted deliveries.
 * Inspired by DeepSeek Harness tool-present; attribution lives in the package README.
 * @module @arx-ai/arx-tool-present
 */
import type { Context } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import { FsError } from '@arx-ai/arx-fs'
import { defineTool, type ToolExecution } from '@arx-ai/arx-tools'
import type {} from '@arx-ai/arx-agent'
import type { Session } from '@arx-ai/arx-session'
import type { PresentedFile, PresentedFilesEvent } from './types.ts'

export type * from './types.ts'

/** Stable Loader identity. */
export const name = 'tool-present'
/** Required runtime capabilities. */
export const inject = ['tools', 'fs']

/** Per-call bounds on retained file references, not source file contents. */
export interface Config {
  /** Maximum number of submitted files, including repeated paths. */
  maxFiles: number
  /** Inclusive UTF-8 byte cap for the complete deliverables/presented payload. */
  maxMetadataBytes: number
}

/** Validated deployment limits; larger source files do not consume metadata bytes. */
export const Config: z<Config> = z.object({
  maxFiles: z.number().default(8),
  maxMetadataBytes: z.number().default(16384),
})

/** The authoritative open turn, or undefined after its turn/end. */
function openTurn(session: Session): number | undefined {
  const boundary = session.events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
  return boundary?.type === 'turn/start' ? boundary.data.turn : undefined
}

/**
 * Register the delivery tool and its final-success observer.
 * @param ctx - configured filesystem and tool registry.
 * @param config - positive safe count and complete-payload byte bounds.
 */
export function apply(ctx: Context, config: Config): void {
  for (const key of ['maxFiles', 'maxMetadataBytes'] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) {
      throw new Error(`present requires a positive safe integer ${key}`)
    }
  }
  const pending = new WeakMap<ToolExecution, { session: Session; data: PresentedFilesEvent }>()
  ctx.tools.register(defineTool({
    name: 'present',
    description: 'Declare existing files as deliverables for the user, including files created through shell commands or code execution. '
      + 'Call after creating the requested outputs and before your final response. Files must already exist as regular files. '
      + 'The user opens the current source files; their contents are not copied or preserved.',
    parameters: {
      files: {
        type: 'array', required: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            path: { type: 'string', required: true, description: 'Existing regular file. Relative paths use the current working directory.' },
            description: { type: 'string', description: 'Brief explanation of the file for the user.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          turn: { type: 'integer', required: true },
          files: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                description: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.files.map(file => `Validated file for delivery: ${file.path}`).join('\n')
          + '\nCurrent file contents are not copied or preserved.',
      }],
    },
    presentCall: args => ({
      card: 'generic', title: 'Present files',
      locations: args.files.map(file => ({ path: file.path })),
    }),
    async execute(args, exec) {
      const session = exec.agent?.session
      if (session === undefined) throw new Error('present requires an owning agent session')
      const turn = openTurn(session)
      if (turn === undefined) throw new Error('present requires an open turn')
      const cwd = session.header.cwd
      if (cwd === undefined) throw new Error('present requires a working directory')
      if (args.files.length === 0 || args.files.length > config.maxFiles) {
        throw new Error(`present accepts 1 to ${config.maxFiles} files`)
      }
      const files: PresentedFile[] = args.files.map(file => ({ ...file }))
      const data: PresentedFilesEvent = { turn, callId: exec.callId, files }
      if (Buffer.byteLength(JSON.stringify(data), 'utf8') > config.maxMetadataBytes) {
        throw new Error(`present file references exceed ${config.maxMetadataBytes} UTF-8 bytes; shorten descriptions or present fewer files`)
      }
      for (const file of files) {
        if (file.path.trim().length === 0) throw new Error('present requires a non-empty file path')
        const entry = await ctx.fs.lstat(file.path, { cwd }, exec.signal)
        if (entry === undefined) throw new FsError(`Cannot present ${file.path}: file not found`, 'FS_NOT_FOUND')
        if (entry.type !== 'file') throw new Error(`Cannot present ${file.path}: not a regular file`)
        const target = await ctx.fs.resolve(file.path, { cwd, signal: exec.signal })
        const info = await ctx.fs.stat(target, exec.signal)
        if (info === undefined) throw new FsError(`Cannot present ${file.path}: file not found`, 'FS_NOT_FOUND')
        if (info.type !== 'file') throw new Error(`Cannot present ${file.path}: not a regular file`)
      }
      exec.signal.throwIfAborted()
      if (openTurn(session) !== turn) throw new Error('present requires the original turn to remain open')
      pending.set(exec, { session, data })
      return { turn, files }
    },
  }))
  ctx.on('tools/result', (exec, result) => {
    const delivery = pending.get(exec)
    pending.delete(exec)
    if (delivery === undefined || result.isError) return
    if (openTurn(delivery.session) !== delivery.data.turn) {
      ctx.logger.warn('present: the owning turn closed before delivery could be recorded')
      return
    }
    delivery.session.append('deliverables/presented', delivery.data)
  })
}
