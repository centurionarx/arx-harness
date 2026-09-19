/** Bounded view selection over the complete host turn index. */
import type { TurnOutlinePage, TurnOutlineProjection, TurnOutlineEntry } from './types.ts'
/** Maximum entries carried by one projection update or Remote response. */
export const MAX_PAGE_TURNS = 100
/**
 * Select the newest matching page before an exclusive durable sequence.
 * @param state - complete replay-derived host index.
 * @param before - exclusive sequence cursor; null selects the newest entries.
 * @param query - normalized by the caller or raw text to match number/preview.
 * @returns at most 100 entries and an explicit older-page cursor.
 */
export function outlinePage(state: TurnOutlineProjection, before: number | null = null, query = ''): TurnOutlinePage {
  const search = query.trim().toLocaleLowerCase()
  const selected: TurnOutlineEntry[] = []
  let hasMore = false
  outer: for (let chunk = state.head; chunk !== null; chunk = chunk.previous) {
    for (const turn of chunk.entries.toReversed()) {
      if (before !== null && turn.startSeq >= before) continue
      if (search !== '' && !(String(turn.turn) + ' ' + turn.preview).toLocaleLowerCase().includes(search)) continue
      if (selected.length === MAX_PAGE_TURNS) { hasMore = true; break outer }
      selected.push(turn)
    }
  }
  selected.reverse()
  return { turns: selected, total: state.total, hasMore,
    ...(hasMore && selected[0] !== undefined ? { nextBefore: selected[0].startSeq } : {}) }
}
