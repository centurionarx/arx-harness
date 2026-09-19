/** Pure wire types for the whole-session turn index. */
export interface TurnOutlineEntry {
  /** Host-assigned turn number. */
  readonly turn: number
  /** Sequence of the turn/start event, used as the navigation address. */
  readonly startSeq: number
  /** Sequence of turn/end; absent while the turn remains open. */
  readonly endSeq?: number | undefined
  /** First direct user text, whitespace-normalized and capped at 120 Unicode code points. */
  readonly preview: string
  /** running while open; otherwise the recorded turn-end reason kind. */
  readonly status: string
}
/** Persistent bounded chunk; older chunks remain immutable and shared. */
export interface TurnOutlineChunk {
  readonly entries: readonly TurnOutlineEntry[]
  readonly previous: TurnOutlineChunk | null
}
/** Complete host index with constant-bounded append work and linear retained state. */
export interface TurnOutlineProjection {
  readonly head: TurnOutlineChunk | null
  readonly total: number
}
/** One bounded page of matching turns; no historical entries are discarded. */
export interface TurnOutlinePage {
  readonly turns: readonly TurnOutlineEntry[]
  /** Complete session turn count, independent of the current search. */
  readonly total: number
  readonly hasMore: boolean
  /** Exclusive turn/start sequence cursor for the next older page. */
  readonly nextBefore?: number | undefined
}
declare module '@arx-ai/arx-session-projection/types' {
  interface SessionProjectionMap {
    /** Newest bounded page of whole-log turn addresses. */
    turnOutline: TurnOutlinePage
  }
  interface SessionProjectionStateMap {
    /** Full host index; wire responses select bounded pages. */
    turnOutline: TurnOutlineProjection
  }
}
