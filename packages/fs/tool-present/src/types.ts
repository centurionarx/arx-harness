/**
 * Durable declarations of files available from a Session's filesystem.
 * @module @arx-ai/arx-tool-present/types
 */
import type { CallId } from '@arx-ai/arx-llm/brand'

/** A current file reference; contents are never copied into the Session. */
export interface PresentedFile {
  /** Original file path, relative to the owning Session's cwd when not absolute. */
  readonly path: string
  /** Optional explanation supplied with the file. */
  readonly description?: string
}

/** Complete set of file references accepted by one present call. */
export interface PresentedFilesEvent {
  /** Open turn that owns this delivery. */
  readonly turn: number
  /** Root or nested tool call that validated the files. */
  readonly callId: CallId
  /** Files validated before the successful result was published. */
  readonly files: readonly PresentedFile[]
}

declare module '@arx-ai/arx-session/types' {
  interface SessionEventMap {
    /**
     * Existing file references declared by a successful present call.
     * @param data - owning turn, tool call, and validated current-file references.
     */
    'deliverables/presented': PresentedFilesEvent
  }
}
