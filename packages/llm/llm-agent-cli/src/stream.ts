/**
 * Translation from the vendor SDK's message stream to the harness chunk
 * protocol.
 *
 * @module @arx-ai/arx-llm-agent-cli/stream
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { CallId, type ContentBlock, type ContentBlockType, type StreamChunk, type TokenUsage } from '@arx-ai/arx-llm'

import { harnessToolName } from './tools.ts'

/** One content block being assembled from its deltas. */
interface OpenBlock {
  readonly blockType: ContentBlockType
  text: string
  readonly toolCallId?: string
  readonly toolName?: string
}

/** Anthropic reports uncached input separately from cache reads and writes. */
function usageChunk(usage: {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}): TokenUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    ...usage.cache_read_input_tokens == null ? {} : { cacheReadTokens: usage.cache_read_input_tokens },
    ...usage.cache_creation_input_tokens == null ? {} : { cacheWriteTokens: usage.cache_creation_input_tokens },
  }
}

/** Assemble the block a `block-end` must carry. */
function assembled(open: OpenBlock): ContentBlock {
  switch (open.blockType) {
    case 'reasoning':
      return { type: 'reasoning', text: open.text }
    case 'tool-call':
      return {
        type: 'tool-call',
        id: CallId(open.toolCallId ?? ''),
        name: open.toolName ?? '',
        arguments: open.text,
      }
    default:
      return { type: 'text', text: open.text }
  }
}

/** Map one vendor content-block kind onto the harness block vocabulary. */
function blockTypeOf(kind: string): ContentBlockType {
  if (kind === 'thinking') return 'reasoning'
  if (kind === 'tool_use') return 'tool-call'
  return 'text'
}

/** The record notation one replayed transcript writes past tool calls in. */
const RECORD_MARKER = '[requested '
const RECORD_WITH = ' with '
/** Harness tools are lowercase with separators; anything else is not ours to convert. */
const HARNESS_NAME = /^[a-z][a-z0-9_-]*$/

/** One record read back out of an assistant text block. */
interface RecordCall {
  readonly name: string
  readonly arguments: string
}

/**
 * First stream index issued to a repaired block. Vendor indices count the
 * vendor message's content blocks one small number at a time, so a base far
 * above them cannot collide mid-stream.
 */
const SYNTHETIC_INDEX_BASE = 1_000_000

/**
 * Monotonic within the process, so a converted id collides with nothing:
 * vendor ids never carry this stem.
 */
let converted = 0

function convertedId(): CallId {
  converted += 1
  return CallId(`converted-${converted}`)
}

/**
 * Read one trailing record out of `rest`, whose final character must close
 * one. A name outside the harness convention, JSON that does not parse, or a
 * name this request does not serve leaves the text untouched: converting a
 * guess would dispatch a tool call the model never made.
 * @param rest - the unconsumed tail of one text block, already trimmed.
 * @param served - harness tool names this request assembled, or `undefined` to accept any harness-shaped name.
 * @returns the shorter rest and the record, or `undefined` when the tail holds no record.
 */
function oneTrailingRecord(
  rest: string,
  served: ReadonlySet<string> | undefined,
): { rest: string; call: RecordCall } | undefined {
  if (!rest.endsWith(']')) return undefined
  const marker = rest.lastIndexOf(RECORD_MARKER)
  if (marker === -1) return undefined
  const body = rest.slice(marker + RECORD_MARKER.length, rest.length - 1)
  const withAt = body.indexOf(RECORD_WITH)
  if (withAt === -1) return undefined
  const name = harnessToolName(body.slice(0, withAt))
  if (!HARNESS_NAME.test(name) || (served !== undefined && !served.has(name))) return undefined
  const args = body.slice(withAt + RECORD_WITH.length).trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch {
    // A notation quote without valid JSON is text, not a call; reading only
    // the one statement means nothing else can reach this value.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  return { rest: rest.slice(0, marker).trimEnd(), call: { name, arguments: args } }
}

/**
 * The degenerate-output repair. The replayed transcript arms the model with
 * the record notation, and a model that continues that transcript in prose
 * ends its turn with records as text: the agent loop can neither execute them
 * nor report the turn as tool work, and the user reads the call's JSON
 * interleaved with the answer. A maximal trailing run of well-formed records
 * becomes tool calls; a record quoted mid-sentence is left alone because only
 * the trail is read.
 * @param text - the assembled text of one assistant text block.
 * @param served - harness tool names this request assembled, or `undefined` to accept any harness-shaped name.
 * @returns the text to keep and the trailing records, in record order.
 */
export function degenerateTail(
  text: string,
  served: ReadonlySet<string> | undefined,
): { text: string; calls: readonly RecordCall[] } {
  const calls: RecordCall[] = []
  let rest = text.trimEnd()
  for (
    let record = oneTrailingRecord(rest, served);
    record !== undefined;
    record = oneTrailingRecord(rest, served)
  ) {
    calls.push(record.call)
    rest = record.rest
  }
  return { text: rest, calls: calls.reverse() }
}

/**
 * Convert the SDK message stream into harness chunks.
 *
 * One `stream()` call is one assistant turn, and the translation ends the
 * moment that turn does. The CLI's own turn cap cannot express this: reaching
 * it makes the SDK throw an error result rather than finish, so the cap would
 * turn every ordinary tool-calling turn into a failure.
 *
 * The iterator is pulled rather than iterated with `for await`, because the
 * conversation outlives this turn: leaving a `for await` calls `return()` on
 * the vendor run, ending the very conversation the next turn continues.
 *
 * A text block that ends in the replayed transcript's record notation is
 * repaired into the tool calls it states, so the loop executes what the model
 * asked for instead of showing its JSON as prose.
 *
 * The finish reason comes from the emitted content: a turn that asked for a
 * tool reports `tool-calls`, whatever the vendor would have said about it.
 * @param messages - the live vendor message iterator, positioned at this turn.
 * @param served - harness tool names this request assembled; a trailing
 *   record naming anything else stays text (pass `undefined` to accept any
 *   harness-shaped name).
 * @returns the harness chunk stream for that turn.
 */
export async function* translate(
  messages: AsyncIterator<SDKMessage>,
  served?: ReadonlySet<string>,
): AsyncIterable<StreamChunk> {
  const open = new Map<number, OpenBlock>()
  let sawToolCall = false
  let failure: string | undefined
  let repaired = 0

  for (;;) {
    const pulled = await messages.next()
    if (pulled.done === true) break
    const message = pulled.value
    if (message.type === 'result') {
      if (message.subtype !== 'success' && message.subtype !== 'error_max_turns') {
        failure = message.subtype
      }
      continue
    }
    if (message.type !== 'stream_event') continue
    const event = message.event as { type: string } & Record<string, unknown>

    if (event.type === 'message_start') {
      const start = event as unknown as { message: { usage?: Parameters<typeof usageChunk>[0] } }
      if (start.message.usage !== undefined) yield { type: 'usage', usage: usageChunk(start.message.usage) }
      continue
    }

    if (event.type === 'content_block_start') {
      const start = event as unknown as {
        index: number
        content_block: { type: string; id?: string; name?: string }
      }
      const blockType = blockTypeOf(start.content_block.type)
      if (blockType === 'tool-call') sawToolCall = true
      open.set(start.index, {
        blockType,
        text: '',
        ...start.content_block.id === undefined ? {} : { toolCallId: start.content_block.id },
        ...start.content_block.name === undefined ? {} : { toolName: harnessToolName(start.content_block.name) },
      })
      yield { type: 'block-start', index: start.index, blockType }
      continue
    }

    if (event.type === 'content_block_delta') {
      const delta = event as unknown as {
        index: number
        delta: { type: string; text?: string; thinking?: string; partial_json?: string }
      }
      const block = open.get(delta.index)
      if (block === undefined) continue
      if (delta.delta.type === 'text_delta' && delta.delta.text !== undefined) {
        block.text += delta.delta.text
        yield { type: 'text-delta', index: delta.index, text: delta.delta.text }
      } else if (delta.delta.type === 'thinking_delta' && delta.delta.thinking !== undefined) {
        block.text += delta.delta.thinking
        yield { type: 'reasoning-delta', index: delta.index, text: delta.delta.thinking }
      } else if (delta.delta.type === 'input_json_delta' && delta.delta.partial_json !== undefined) {
        block.text += delta.delta.partial_json
        yield {
          type: 'tool-call-delta',
          index: delta.index,
          id: CallId(block.toolCallId ?? ''),
          ...block.toolName === undefined ? {} : { name: block.toolName },
          argumentsDelta: delta.delta.partial_json,
        }
      }
      continue
    }

    if (event.type === 'content_block_stop') {
      const stop = event as unknown as { index: number }
      const block = open.get(stop.index)
      if (block === undefined) continue
      open.delete(stop.index)
      // A model that continues the replayed transcript's record notation in
      // prose ends its turn with text fake-calling tools. The trail becomes
      // real tool calls so the loop executes what the model asked for; the
      // deltas already streamed are superseded by this authoritative close.
      if (block.blockType === 'text') {
        const tail = degenerateTail(block.text, served)
        if (tail.calls.length > 0) {
          yield { type: 'block-end', index: stop.index, block: { type: 'text', text: tail.text } }
          for (const call of tail.calls) {
            const index = SYNTHETIC_INDEX_BASE + repaired++
            const id = convertedId()
            yield { type: 'block-start', index, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index, id, name: call.name, argumentsDelta: call.arguments }
            yield {
              type: 'block-end',
              index,
              block: { type: 'tool-call', id, name: call.name, arguments: call.arguments },
            }
          }
          sawToolCall = true
          continue
        }
      }
      yield { type: 'block-end', index: stop.index, block: assembled(block) }
      continue
    }

    if (event.type === 'message_delta') {
      const message_delta = event as unknown as { usage?: Parameters<typeof usageChunk>[0] }
      if (message_delta.usage !== undefined) yield { type: 'usage', usage: usageChunk(message_delta.usage) }
      continue
    }

    // The assistant turn is over. Reading further would consume the vendor's
    // next turn, which this call did not ask for.
    if (event.type === 'message_stop') break
  }

  if (failure !== undefined) {
    yield { type: 'finish', reason: { kind: 'error', failure: { message: `vendor CLI returned ${failure}`, code: 'AGENT_CLI_ERROR' } } }
    return
  }
  yield { type: 'finish', reason: sawToolCall ? { kind: 'tool-calls' } : { kind: 'stop' } }
}
