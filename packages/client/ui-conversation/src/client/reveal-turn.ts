/** Bounded event-window expansion for a turn selected by another view. */
import type { ConversationSnapshot, SessionFace } from '@arx-ai/arx-client-runtime/client'

function head(snapshot: ConversationSnapshot): number {
  let seq = snapshot.chat.nodes.get(snapshot.chat.order[0] ?? '')?.anchorSeq ?? Infinity
  for (const turn of snapshot.chat.timeline.turns.values()) seq = Math.min(seq, turn.start?.seq ?? Infinity)
  return seq
}

/**
 * Locate the first visible row of an exact turn boundary, expanding history serially.
 * Returns null for missing boundaries/rows, failed or non-progressing pages, a
 * closed session, cancellation, or the page limit. Cancellation does not abort
 * a runtime history request already in flight.
 * @param session - conversation binding that owns history paging.
 * @param startSeq - exact durable turn/start address.
 * @param isCurrent - ownership check invalidated by cancellation or session switch.
 * @param maxPages - maximum older-history requests attempted by this reveal.
 * @returns the first visible node in the exact turn, or null when unavailable.
 */
export async function revealTurnNode(
  session: Pick<SessionFace, 'getSnapshot' | 'loadOlder'>,
  startSeq: number,
  isCurrent: () => boolean,
  maxPages = 20,
): Promise<string | null> {
  if (!Number.isSafeInteger(startSeq) || startSeq < 0) return null
  for (let page = 0; page <= maxPages; page += 1) {
    if (!isCurrent()) return null
    const snapshot = session.getSnapshot()
    if (snapshot.openState !== 'open' || snapshot.removed) return null
    for (const turn of snapshot.chat.timeline.turns.values()) {
      if (turn.start?.seq !== startSeq) continue
      return snapshot.chat.locations.getTurn(turn.turn).find(key => snapshot.chat.nodes.get(key)?.visibility === 'visible') ?? null
    }
    if (!snapshot.hasMore || snapshot.loadingOlder || page === maxPages) return null
    const previousHead = head(snapshot)
    try { await session.loadOlder() } catch { return null }
    if (!isCurrent() || head(session.getSnapshot()) >= previousHead) return null
  }
  return null
}
