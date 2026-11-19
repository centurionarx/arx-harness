/**
 * Durable session-persistence Service Definition (`ctx.sessionPersistence`). Backends store
 * {@link SessionEvent}s as the event-sourced log and carry non-replayable
 * {@link SessionHeader} metadata separately.
 * @module @arx-ai/arx-session-persistence
 */

import { Context, Service } from '@arx-ai/cordis'
import { SessionPreparation } from '@arx-ai/arx-session'
import type { SessionEvent, SessionId, SessionHeader } from '@arx-ai/arx-session'
import type { SessionPersistenceRevision } from './revision.ts'
import type { PersistenceCoordinator } from './coordinator.ts'

// Re-export the metadata vocabulary so Consumers import it from the Service Definition.
export type { SessionHeader } from '@arx-ai/arx-session'
export { SessionPersistenceRevision } from './revision.ts'

/** Lightweight immutable source identity returned without loading a full log. */
export interface SessionPersistenceSnapshot {
  /** Detached metadata for one materialized session. */
  header: SessionHeader
  /** Opaque source-qualified token that changes whenever this stored log changes. */
  revision: SessionPersistenceRevision
}

/** Immutable logical session prepared from persistence or a live owner. */
export interface SessionInspection {
  /** Validated immutable session metadata. */
  readonly meta: SessionHeader
  /** Validated contiguous logical event log. */
  readonly events: readonly SessionEvent[]
}

/** A backend's own raw artifact text for one session, verbatim. */
export interface SessionRawArtifact {
  /** The session header parsed from the artifact's own first line. */
  readonly meta: SessionHeader
  /** The artifact's base filename on disk, without any physical encoding suffix. */
  readonly filename: string
  /** The artifact's full text content, decoded from the backend's physical encoding. */
  readonly content: string
}

/** A revision-bound decoded byte range requested without a full artifact read. */
export interface SessionRawArtifactPageRequest {
  /** Inclusive UTF-8 byte offset, initially zero. */
  readonly offset: number
  /** Largest returned plaintext range; at least four bytes for UTF-8 carry. */
  readonly maxBytes: number
  /** Previous page's exact source revision; changed artifacts reject. */
  readonly revision?: SessionPersistenceRevision
}
/** A bounded raw page, preserving the backend's original serialization. */
export interface SessionRawArtifactPage {
  /** Header validated from the independently readable first record. */
  readonly meta: SessionHeader
  /** Logical artifact filename, without its physical compression suffix. */
  readonly filename: string
  /** Requested decoded byte offset. */
  readonly offset: number
  /** Complete UTF-8 text with at most the requested byte budget. */
  readonly content: string
  /** Inclusive next byte offset when another page may be present. */
  readonly nextOffset?: number
  /** Stable source identity required for a continuation. */
  readonly revision: SessionPersistenceRevision
}

// The backend-agnostic write-path orchestration first-party backends compose.
export {
  DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  DEFAULT_WRITE_BATCH_MAX_DELAY_MS,
  MAX_WRITE_BATCH_DELAY_MS,
  PersistenceCoordinator,
  SessionFormatUnsupportedError,
  SessionPersistenceCorruptionError,
  sessionFormatVersionRefusal,
} from './coordinator.ts'
export type {
  PersistenceBackend,
  PersistenceCoordinatorOptions,
  StoredPrefix,
  StoredSuffix,
} from './coordinator.ts'

declare module '@arx-ai/cordis' {
  interface Context {
    sessionPersistence: SessionPersistence
  }
}

/**
 * A backend-resolved, per-session local artifact location. The path is an
 * absolute target path and can name an artifact that has not materialized yet.
 * Consumers must treat it as a location hint, never as an authorization token.
 */
export interface SessionLocation {
  /** Backend-specific artifact kind, for example `jsonl`. */
  readonly kind: string
  /** Absolute path to this session's backend-owned artifact. */
  readonly path: string
}

/**
 * Durable append-only session storage. Implementations preserve contiguous,
 * losslessly JSON-serializable events; {@link append} resolves only after
 * durability, and {@link load} balances a complete interrupted tail without
 * rewriting committed events.
 */
export abstract class SessionPersistence extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionPersistence')
  }

  /**
   * Resolve this backend's independent local artifact for a session without
   * reading, creating, flushing, or otherwise materializing it. Backends such
   * as SQLite that do not own one artifact per session return `undefined`.
   * @param meta - the immutable session header whose artifact is requested.
   * @returns the backend-specific absolute location, when one exists.
   */
  abstract locate(meta: SessionHeader): SessionLocation | undefined

  /**
   * Whether this backend exposes one verbatim raw artifact per session.
   * A backend that declares `true` must override {@link readRaw}.
   */
  abstract readonly supportsRawArtifacts: boolean

  /**
   * Read a session's backend-owned artifact text verbatim — the exact durable
   * bytes the backend wrote (decoded from its physical encoding, e.g. a
   * decompressed JSONL). The returned `content` is the raw text, not a
   * reconstruction from parsed events, so it preserves backend-specific
   * serialization (chunk packing, key order, line breaks). Callers first test
   * {@link supportsRawArtifacts}; `undefined` then means only that the requested
   * session has no materialized artifact.
   * @param _id - the persisted session to read (unused by the default: no
   * per-session artifact).
   * @param signal - optional cancellation for backend read work.
   * @returns the raw artifact plus its parsed header, or `undefined` when the
   * session is absent.
   * @throws when this backend does not expose per-session raw artifacts.
   */
  readRaw(_id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined> {
    if (signal?.aborted === true) {
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    return Promise.reject(new Error('this session persistence backend does not expose raw artifacts'))
  }

  /**
   * Whether raw pages use bounded retained plaintext rather than a full-log
   * buffer. The default deliberately declares no range capability.
   */
  readonly supportsRawArtifactPages: boolean = false

  /**
   * Read an independently revision-bound UTF-8 page without falling back to
   * {@link readRaw}. A checksummed backend may decode a whole containing frame
   * while retaining only the requested page. Unknown providers reject.
   * @param _id - Persisted session identity.
   * @param _request - Decoded byte range and optional continuation revision.
   * @param signal - Optional cancellation.
   * @returns A bounded artifact page or undefined for an absent artifact.
   * @throws For unsupported range reads, invalid offsets or a changed revision.
   */
  readRawPage(_id: SessionId, _request: SessionRawArtifactPageRequest, signal?: AbortSignal): Promise<SessionRawArtifactPage | undefined> {
    if (signal?.aborted === true) {
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    return Promise.reject(new Error('this session persistence backend does not expose bounded raw pages'))
  }

  /**
   * Register a new session's metadata. A backend MAY defer the physical write
   * until the first {@link append} (lazy materialization), in which case a
   * created-but-never-appended session is absent from {@link list}
   * — abandoned sessions leave nothing behind.
   * @param meta - the immutable header (id, version, cwd, lineage) to record.
   */
  abstract create(meta: SessionHeader): Promise<void>

  /**
   * Explicitly commit a registered header without inventing events. Default
   * creation remains lazy; providers that do not own this capability reject.
   * Successful repeated calls preserve the existing artifact unchanged.
   * @param _id - Registered session whose canonical header must be durable.
   * @returns Completion only after the provider's durable header receipt.
   */
  materialize(_id: SessionId): Promise<void> {
    return Promise.reject(new Error('this session persistence backend does not support explicit header materialization'))
  }

  /**
   * Durably persist a batch of events. Honors the append-only and contiguous-
   * seq contracts: the first event's `seq` MUST equal the stored next-seq
   * (after `load` has durably closed any interrupted turn). Rejects non-JSON-
   * serializable `event.data` with an error naming the offending event type.
   * @param id - the session the batch belongs to.
   * @param events - the contiguous batch to persist, in seq order.
   */
  abstract append(id: SessionId, events: readonly SessionEvent[]): Promise<void>

  /**
   * Prepare the exact unpublished Session used by resume. Implementations may
   * reuse object graphs retained by an earlier {@link inspect} after confirming
   * their durable revision is still current; disposal releases an unpublished
   * reservation. Revision retries require the durable log to remain unchanged
   * for one read/check round trip; continuous external writers may delay completion.
   * @param id - persisted session to prepare.
   * @param signal - optional cancellation for preparation work.
   * @returns one owned unpublished Session preparation.
   */
  async prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation> {
    signal?.throwIfAborted()
    const loaded = await this.load(id)
    signal?.throwIfAborted()
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) {
      throw new Error('cannot prepare a session: SessionStore is not configured')
    }
    return SessionPreparation.create(sessions.prepare(id, {
      seed: loaded.events.map(event => structuredClone(event)),
      meta: structuredClone(loaded.meta),
      seedSource: 'persistence',
    }))
  }

  /**
   * Load an immutable balanced logical view and commit any required cold
   * recovery. A complete interrupted final turn is preserved and durably
   * closed with missing tool errors plus any open step and turn boundaries;
   * only a torn final record is discarded. Unknown versions and corruption in
   * the committed prefix reject. Implementations MUST NOT crash-repair an
   * identity still bound to a live Session: a balanced live log may return as a
   * durable snapshot, while an open live turn rejects. Returned values may be
   * shared with immutable live or prepared state and must not be mutated.
   * Revision-based implementations may wait for one stable read/check round trip.
   * @param id - the persisted session to reload.
   * @returns the header and a log ending on a balanced `turn/end`.
   */
  abstract load(id: SessionId): Promise<SessionInspection>

  /**
   * Inspect an immutable logical session without committing recovery or
   * publishing it. A cold complete interrupted turn receives synthetic closers
   * in memory and a torn physical tail remains untouched. An already-live
   * Session instead yields its current immutable snapshot, which may contain an
   * open turn and its `session/end-seed` boundary. Coordinator-backed
   * implementations retain the exact cold unpublished Session for bounded
   * reuse by a later {@link prepare}. A stale ready source is reloaded; a source
   * already committing or reserved for resume remains exclusive, and inspection
   * may borrow its immutable view. Callers borrow only the immutable header and
   * log. Continuous external writers may delay revision convergence.
   * @param id - the persisted session to inspect.
   * @param signal - optional cancellation for queued and backend read work.
   * @returns the validated header and current logical event log.
   */
  abstract inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>

  /**
   * Read the stored events from `fromSeq` onward — the read-from-seq
   * primitive for read models that resume from a watermark (e.g. a persisted
   * projection cache folding only the tail past its checkpoint). Unlike
   * {@link inspect}, it is a detached physical suffix read: no preparation
   * cache, torn-tail truncation, synthetic closers, or coordinator-state
   * publication. Only events from the valid contiguous stored prefix are
   * returned, so a torn fragment never reaches the caller. `fromSeq` at or
   * beyond the stored prefix returns an empty event list (never an error).
   * Backends whose medium can seek by seq
   * (SQLite) read only the suffix; sequential media (JSONL, both encodings)
   * still parse the whole artifact and skip forward — the primitive bounds
   * what is RETURNED and refolded, not every backend's physical read.
   * @param id - the persisted session to read.
   * @param fromSeq - first event seq to include; a non-negative safe integer.
   * @param signal - optional cancellation for queued and backend read work.
   * @returns the header and the stored events with `seq >= fromSeq`.
   */
  abstract readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal):
  Promise<{ meta: SessionHeader; events: SessionEvent[] }>

  /**
   * Lightweight listing from metadata, without a full-log parse.
   * @param signal - optional cancellation for backend listing work.
   * @returns one header per materialized session.
   */
  abstract list(signal?: AbortSignal): Promise<SessionHeader[]>

  /**
   * List materialized sessions with cheap per-log change tokens.
   *
   * Repeated observations of an unchanged log return the same revision. A
   * successful mutating {@link load} repair changes the next listed revision.
   * Revisions also distinguish independently backed stores so backend-local
   * counters cannot compare equal across different persistence sources.
   * @param signal - optional cancellation for backend snapshot-listing work.
   * @returns one header and opaque revision per materialized session without loading full logs.
   */
  abstract listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>

  /**
   * Observe one materialized log's source-qualified revision without mutation.
   * Providers with direct identity lookup override this metadata-list fallback.
   * An unchanged source keeps its revision; an absent lazy log returns undefined.
   * @param id - Persisted session identity, independent of any index projection.
   * @param signal - Optional cancellation for the provider's observation.
   * @returns The provider's current revision, or undefined for an absent log.
   */
  async readRevision(id: SessionId, signal?: AbortSignal): Promise<SessionPersistenceRevision | undefined> {
    signal?.throwIfAborted()
    const snapshot = (await this.listSnapshots(signal)).find(value => value.header.id === id)
    signal?.throwIfAborted()
    return snapshot?.revision
  }
}

/**
 * The six canonical delegates used by persistence providers that already own a
 * {@link PersistenceCoordinator}. Storage, lookup, capabilities and ownership
 * stay in each provider; the existing constructor and coordinator are retained.
 * @typeParam TornMarker - The provider's opaque interrupted-tail repair token.
 */
export abstract class CoordinatedSessionPersistence<TornMarker = unknown> extends SessionPersistence {
  /** The provider's existing coordinator, initialized by its original constructor. */
  protected abstract readonly coordinator: PersistenceCoordinator<TornMarker>

  /**
   * Snapshot lazy session metadata in the existing coordinator.
   * @param meta - Immutable existing-format session header.
   * @returns Completion after coordinator admission.
   */
  override create(meta: SessionHeader): Promise<void> { return this.coordinator.create(meta) }

  /**
   * Serialize a contiguous append through the original durable coordinator.
   * @param id - Session identity resolved by the provider's own backend.
   * @param events - Ordered existing-format events.
   * @returns Completion after the backend's durable receipt.
   */
  override append(id: SessionId, events: readonly SessionEvent[]): Promise<void> { return this.coordinator.append(id, events) }

  /**
   * Prepare an unpublished session without changing adoption or repair policy.
   * @param id - Persisted session identity.
   * @param signal - Optional preparation cancellation.
   * @returns The coordinator's canonical preparation reservation.
   */
  override prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation> { return this.coordinator.prepare(id, signal) }

  /**
   * Load the canonical header and repaired committed event prefix.
   * @param id - Persisted session identity.
   * @returns The coordinator's validated inspection.
   */
  override load(id: SessionId): Promise<SessionInspection> { return this.coordinator.load(id) }

  /**
   * Inspect stored history through the coordinator's existing preparation cache.
   * @param id - Persisted session identity.
   * @param signal - Optional inspection cancellation.
   * @returns The original immutable header and committed events.
   */
  override inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection> { return this.coordinator.inspect(id, signal) }

  /**
   * Read a stored suffix through the provider's original backend.
   * @param id - Persisted session identity.
   * @param fromSeq - First canonical sequence to return.
   * @param signal - Optional suffix-read cancellation.
   * @returns The original header and detached stored event suffix.
   */
  override readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    return this.coordinator.readFrom(id, fromSeq, signal)
  }
}

export default SessionPersistence
