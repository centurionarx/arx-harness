/** Persistent chunks keep replay work bounded without truncating historical turns. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@arx-ai/arx-session-projection'
import { outlinePage, MAX_PAGE_TURNS } from './page.ts'
import type { TurnOutlineChunk, TurnOutlineProjection, TurnOutlinePage } from './types.ts'
const CHUNK_TURNS = 256
const entrySchema = z.object({
  turn: z.number().int().positive(), startSeq: z.number().int().nonnegative(),
  endSeq: z.number().int().nonnegative().optional(), preview: z.string().max(240), status: z.string().min(1),
}).strict()
const chunkSchema: z.ZodType<TurnOutlineChunk> = z.lazy(() => z.object({
  entries: z.array(entrySchema).min(1).max(CHUNK_TURNS), previous: chunkSchema.nullable(),
}).strict())
const stateSchema: z.ZodType<TurnOutlineProjection> = z.object({
  head: chunkSchema.nullable(), total: z.number().int().nonnegative(),
}).strict()
const pageSchema: z.ZodType<TurnOutlinePage> = z.object({
  turns: z.array(entrySchema).max(MAX_PAGE_TURNS), total: z.number().int().nonnegative(),
  hasMore: z.boolean(), nextBefore: z.number().int().nonnegative().optional(),
}).strict()
/** Pure complete-history fold; updates copy at most the current 256-entry chunk. */
export const turnOutlineDefinition = {
  key: 'turnOutline', stateVersion: 2, stateSchema,
  init: (): TurnOutlineProjection => ({ head: null, total: 0 }),
  apply: (state, event) => {
    const head = state.head
    if (event.type === 'turn/start') {
      const entry = { turn: event.data.turn, startSeq: event.seq, preview: '', status: 'running' }
      return { total: state.total + 1, head: head !== null && head.entries.length < CHUNK_TURNS
        ? { entries: [...head.entries, entry], previous: head.previous }
        : { entries: [entry], previous: head } }
    }
    const current = head?.entries.at(-1)
    if (head === null || current === undefined || current.endSeq !== undefined) return state
    if (event.type === 'user/message' && event.data.source.kind === 'user' && current.preview === '') {
      const text = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(' ')
      const preview = Array.from(text.replace(/\s+/gu, ' ').trim()).slice(0, 120).join('')
      if (preview === '') return state
      return { total: state.total, head: { previous: head.previous,
        entries: [...head.entries.slice(0, -1), { ...current, preview }] } }
    }
    if (event.type === 'turn/end' && event.data.turn === current.turn) {
      return { total: state.total, head: { previous: head.previous,
        entries: [...head.entries.slice(0, -1), { ...current, endSeq: event.seq, status: event.data.reason.kind }] } }
    }
    return state
  },
  wire: { viewSchema: pageSchema, view: state => outlinePage(state) },
} satisfies ProjectionDefinition<'turnOutline', TurnOutlineProjection>
