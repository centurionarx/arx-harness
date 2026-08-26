/**
 * One live vendor conversation per harness session, and the divergence check
 * that decides when that conversation is no longer a valid continuation.
 *
 * @module @centurionarx/cxh-llm-agent-cli/session
 */

import { createHash } from 'node:crypto'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Message } from '@centurionarx/cxh-llm'

import type { VendorUserMessage } from './prompt.ts'

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
 * The input a live vendor run consumes.
 *
 * The vendor accepts an async iterable and reads it for as long as the run
 * lives, so this stays open across turns: each turn pushes what that turn
 * adds, and the run continues rather than restarting.
 */
export class ConversationInput implements AsyncIterable<VendorUserMessage> {
  private readonly queued: VendorUserMessage[] = []
  private waiting: ((result: IteratorResult<VendorUserMessage>) => void) | undefined
  private closed = false

  /**
   * Deliver one message to the running conversation.
   * @param message - the vendor-shaped user message this turn adds.
   */
  push(message: VendorUserMessage): void {
    const waiting = this.waiting
    if (waiting === undefined) {
      this.queued.push(message)
      return
    }
    this.waiting = undefined
    waiting({ value: message, done: false })
  }

  /** End the input, which ends the vendor run once it drains. */
  close(): void {
    this.closed = true
    const waiting = this.waiting
    if (waiting === undefined) return
    this.waiting = undefined
    waiting({ value: undefined, done: true })
  }

  /**
   * Iterate what this conversation has been given.
   * @returns the iterator the vendor run consumes.
   */
  [Symbol.asyncIterator](): AsyncIterator<VendorUserMessage> {
    return {
      next: (): Promise<IteratorResult<VendorUserMessage>> => {
        const queued = this.queued.shift()
        if (queued !== undefined) return Promise.resolve({ value: queued, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => { this.waiting = resolve })
      },
    }
  }
}

/** One vendor run serving one harness session across turns. */
export interface LiveConversation {
  /** What this run reads; a turn pushes its delta here. */
  readonly input: ConversationInput
  /** What this run produces, pulled one turn at a time. */
  readonly messages: AsyncIterator<SDKMessage>
  /** Release the run and the process tree behind it. */
  readonly dispose: () => void
}

/** How the next request reaches the vendor. */
export interface Continuation {
  /** The run to continue, absent when one must be started. */
  readonly live?: LiveConversation
  /** Messages this request must deliver — the delta, or the whole history. */
  readonly deliver: readonly Message[]
  /** Digests the caller commits once the vendor accepts the request. */
  readonly digests: readonly string[]
}

/**
 * Keep one vendor run alive per harness session.
 *
 * The vendor owns its own conversation state, so a request that merely extends
 * what its run already consumed pushes the delta and keeps reading. Anything
 * else — a compaction that rewrote history, a plan-mode edit, a branch — makes
 * that run an invalid continuation, and it is disposed so the next request
 * starts a fresh one.
 */
export class ConversationRegistry {
  private readonly sessions = new Map<string, { live: LiveConversation; consumed: readonly string[] }>()

  /**
   * Decide how one request reaches the vendor, disposing a run whose history
   * no longer matches.
   * @param sessionId - harness session the request belongs to, when it has one.
   * @param messages - the request's complete assembled history.
   * @returns the run to continue and the messages to deliver.
   */
  resolve(sessionId: string | undefined, messages: readonly Message[]): Continuation {
    const digests = messages.map(messageDigest)
    if (sessionId === undefined) return { deliver: messages, digests }
    const held = this.sessions.get(sessionId)
    if (held === undefined) return { deliver: messages, digests }
    const extends_ = held.consumed.length <= digests.length
      && held.consumed.every((digest, index) => digest === digests[index])
    if (!extends_) {
      this.forget(sessionId)
      return { deliver: messages, digests }
    }
    return { live: held.live, deliver: messages.slice(held.consumed.length), digests }
  }

  /**
   * Record the run serving a session and what it has consumed.
   * @param sessionId - harness session the request belonged to, when it had one.
   * @param live - the run that accepted the request.
   * @param digests - the digests {@link resolve} returned for that request.
   */
  commit(sessionId: string | undefined, live: LiveConversation, digests: readonly string[]): void {
    if (sessionId === undefined) {
      live.dispose()
      return
    }
    this.sessions.set(sessionId, { live, consumed: digests })
  }

  /**
   * Dispose one session's run and forget it.
   * @param sessionId - harness session to drop, when it has an id.
   */
  forget(sessionId: string | undefined): void {
    if (sessionId === undefined) return
    const held = this.sessions.get(sessionId)
    if (held === undefined) return
    this.sessions.delete(sessionId)
    held.live.dispose()
  }

  /** Dispose every run this registry holds. */
  disposeAll(): void {
    for (const held of this.sessions.values()) held.live.dispose()
    this.sessions.clear()
  }
}
