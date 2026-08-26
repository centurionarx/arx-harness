/**
 * Affinity between a harness session and the vendor CLI session that serves
 * it, and the divergence check that decides when the CLI session is no longer
 * a valid continuation.
 *
 * @module @centurionarx/cxh-llm-agent-cli/session
 */

import { createHash } from 'node:crypto'
import type { Message } from '@centurionarx/cxh-llm'

/** What one harness session currently holds on the vendor side. */
interface Affinity {
  /** Session id the vendor CLI issued. */
  readonly cliSessionId: string
  /** Per-message digests of everything that session has already consumed. */
  readonly consumed: readonly string[]
}

/** How the next request must reach the vendor CLI. */
export interface Continuation {
  /** Vendor session to resume, absent when the transcript must be replayed. */
  readonly resume?: string
  /** Messages this request must deliver — the delta, or the whole transcript. */
  readonly deliver: readonly Message[]
  /** Digests the caller commits once the vendor accepts the request. */
  readonly digests: readonly string[]
}

/**
 * Digest one message by its content, so an identical message reconstructed by
 * a later request matches the one already delivered.
 * @param message - one assembled conversation message.
 * @returns a stable hex digest of that message.
 */
export function messageDigest(message: Message): string {
  return createHash('sha256').update(JSON.stringify(message)).digest('hex')
}

/**
 * Track which vendor session serves each harness session.
 *
 * The vendor CLI owns its own conversation state, so a request that merely
 * extends what that session already consumed sends the delta and resumes.
 * Anything else — a compaction that rewrote history, a plan-mode edit, a
 * branch — makes the vendor session an invalid continuation, and the
 * transcript is replayed into a fresh one.
 */
export class SessionAffinity {
  private readonly sessions = new Map<string, Affinity>()

  /**
   * Decide how one request reaches the vendor CLI.
   * @param sessionId - harness session the request belongs to, when it has one.
   * @param messages - the request's complete assembled history.
   * @returns the vendor session to resume and the messages to deliver.
   */
  resolve(sessionId: string | undefined, messages: readonly Message[]): Continuation {
    const digests = messages.map(messageDigest)
    if (sessionId === undefined) return { deliver: messages, digests }
    const held = this.sessions.get(sessionId)
    if (held === undefined) return { deliver: messages, digests }
    const extends_ = held.consumed.length <= digests.length
      && held.consumed.every((digest, index) => digest === digests[index])
    if (!extends_) {
      this.sessions.delete(sessionId)
      return { deliver: messages, digests }
    }
    return { resume: held.cliSessionId, deliver: messages.slice(held.consumed.length), digests }
  }

  /**
   * Record what the vendor session consumed once it accepted the request.
   * @param sessionId - harness session the request belonged to, when it had one.
   * @param cliSessionId - session id the vendor CLI reported.
   * @param digests - the digests {@link resolve} returned for that request.
   */
  commit(sessionId: string | undefined, cliSessionId: string, digests: readonly string[]): void {
    if (sessionId === undefined) return
    this.sessions.set(sessionId, { cliSessionId, consumed: digests })
  }

  /**
   * Forget one harness session's vendor affinity.
   * @param sessionId - harness session to drop, when it has an id.
   */
  forget(sessionId: string | undefined): void {
    if (sessionId !== undefined) this.sessions.delete(sessionId)
  }
}
