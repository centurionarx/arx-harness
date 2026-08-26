/**
 * Translation from the vendor SDK's message stream to the harness chunk
 * protocol.
 *
 * @module @centurionarx/cxh-llm-agent-cli/stream
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { CallId, type ContentBlock, type ContentBlockType, type StreamChunk, type TokenUsage } from '@centurionarx/cxh-llm'

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

/**
 * Convert the SDK message stream into harness chunks.
 *
 * One `stream()` call is one assistant turn, and the translation ends the
 * moment that turn does. The CLI's own turn cap cannot express this: reaching
 * it makes the SDK throw an error result rather than finish, so the cap would
 * turn every ordinary tool-calling turn into a failure. Ending here instead
 * leaves the vendor run to the caller, which interrupts it.
 *
 * The finish reason comes from the emitted content: a turn that asked for a
 * tool reports `tool-calls`, whatever the vendor would have said about it.
 * @param messages - the SDK's message stream for one query.
 * @returns the harness chunk stream for that query.
 */
export async function* translate(messages: AsyncIterable<SDKMessage>): AsyncIterable<StreamChunk> {
  const open = new Map<number, OpenBlock>()
  let sawToolCall = false
  let failure: string | undefined

  for await (const message of messages) {
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
