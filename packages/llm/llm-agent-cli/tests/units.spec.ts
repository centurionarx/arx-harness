import { CallId, createUserMessage, LlmError, type Message, type StreamChunk } from '@arx-ai/arx-llm'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'

import { DEFAULT_DISPOSE_GRACE_MS, resolveRoutes } from '../src/config.ts'
import { renderTranscript } from '../src/prompt.ts'
import { translate } from '../src/stream.ts'
import { createToolServer, harnessToolName, toolAlias } from '../src/tools.ts'

/** Feed a fixed message list to the translator. */
async function chunks(messages: readonly unknown[]): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of translate((async function* () {
    for (const message of messages) yield message as never
  })())) out.push(chunk)
  return out
}

/** One `stream_event` message carrying a raw vendor event. */
function event(body: Record<string, unknown>): Record<string, unknown> {
  return { type: 'stream_event', event: body, session_id: 'vendor-1' }
}

describe('tool naming', () => {
  it('namespaces a harness tool the way the CLI presents it', () => {
    expect(toolAlias('bash')).toBe('mcp__arx__bash')
    expect(harnessToolName('mcp__arx__bash')).toBe('bash')
  })

  it('leaves an unprefixed name alone rather than guessing at it', () => {
    expect(harnessToolName('Bash')).toBe('Bash')
  })
})

describe('createToolServer', () => {
  it('serves the harness JSON Schema verbatim', async () => {
    const server = createToolServer([
      { name: 'bash', description: 'run a command', parameters: { type: 'object', properties: { command: { type: 'string' } } } },
    ])
    const handler = (server.server as unknown as {
      _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<{ tools: unknown[] }>>
    })._requestHandlers.get(ListToolsRequestSchema.shape.method.value)
    const listed = await handler?.({ method: 'tools/list', params: {} }, {})
    expect(listed?.tools).toEqual([
      {
        name: 'bash',
        description: 'run a command',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
        // Without this the CLI hides the tool behind its own tool search.
        _meta: { 'anthropic/alwaysLoad': true },
      },
    ])
  })

  it('refuses to execute, because the harness runs every tool itself', async () => {
    const server = createToolServer([])
    const handler = (server.server as unknown as {
      _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<unknown>>
    })._requestHandlers.get(CallToolRequestSchema.shape.method.value)
    await expect(handler?.({ method: 'tools/call', params: { name: 'bash', arguments: {} } }, {}))
      .rejects.toThrow(/never executes tools/)
  })
})

describe('translate', () => {
  it('projects text, reasoning, and usage onto harness chunks', async () => {
    expect(await chunks([
      event({ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } } }),
      event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
      event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } }),
      event({ type: 'content_block_stop', index: 0 }),
      event({ type: 'content_block_start', index: 1, content_block: { type: 'text' } }),
      event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hi' } }),
      event({ type: 'content_block_stop', index: 1 }),
      event({ type: 'message_delta', usage: { output_tokens: 7 } }),
      { type: 'result', subtype: 'success' },
    ])).toEqual([
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 0, cacheReadTokens: 4, cacheWriteTokens: 2 } },
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'hm' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'hm' } },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'hi' },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'hi' } },
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 7 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('recovers the harness tool name and finishes on tool calls', async () => {
    const out = await chunks([
      event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-1', name: 'mcp__arx__bash' } }),
      event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' } }),
      event({ type: 'content_block_stop', index: 0 }),
      { type: 'result', subtype: 'error_max_turns' },
    ])
    expect(out).toContainEqual({ type: 'tool-call-delta', index: 0, id: CallId('call-1'), name: 'bash', argumentsDelta: '{"command":"ls"}' })
    expect(out.at(-2)).toEqual({ type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{"command":"ls"}' } })
    expect(out.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('carries every tool a turn requested, not just the first', async () => {
    const out = await chunks([
      event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-1', name: 'mcp__arx__bash' } }),
      event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' } }),
      event({ type: 'content_block_stop', index: 0 }),
      event({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call-2', name: 'mcp__arx__read' } }),
      event({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"a.ts"}' } }),
      event({ type: 'content_block_stop', index: 1 }),
      { type: 'result', subtype: 'error_max_turns' },
    ])
    expect(out.filter(chunk => chunk.type === 'block-end')).toEqual([
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{"command":"ls"}' } },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: CallId('call-2'), name: 'read', arguments: '{"path":"a.ts"}' } },
    ])
    expect(out.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('keeps interleaved blocks apart by their own index', async () => {
    const out = await chunks([
      event({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      event({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call-1', name: 'mcp__arx__bash' } }),
      event({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } }),
      event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'running' } }),
      event({ type: 'content_block_stop', index: 1 }),
      event({ type: 'content_block_stop', index: 0 }),
      { type: 'result', subtype: 'success' },
    ])
    expect(out.filter(chunk => chunk.type === 'block-end')).toEqual([
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{}' } },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'running' } },
    ])
  })

  it('reports a vendor failure as a terminal error', async () => {
    const out = await chunks([{ type: 'result', subtype: 'error_during_execution' }])
    expect(out).toEqual([{
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'vendor CLI returned error_during_execution', code: 'AGENT_CLI_ERROR' } },
    }])
  })

  it('ignores deltas and stops for a block it never opened', async () => {
    expect(await chunks([
      event({ type: 'content_block_delta', index: 9, delta: { type: 'text_delta', text: 'x' } }),
      event({ type: 'content_block_stop', index: 9 }),
      event({ type: 'message_start', message: {} }),
      event({ type: 'message_delta' }),
      event({ type: 'message_stop' }),
      { type: 'system', subtype: 'init' },
      { type: 'result', subtype: 'success' },
    ])).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  })

  it('defaults every usage field the vendor omits', async () => {
    expect(await chunks([
      event({ type: 'message_delta', usage: {} }),
      { type: 'result', subtype: 'success' },
    ])).toEqual([
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('carries an unnamed tool block rather than dropping the call', async () => {
    const out = await chunks([
      event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use' } }),
      event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
      event({ type: 'content_block_stop', index: 0 }),
      { type: 'result', subtype: 'success' },
    ])
    expect(out[1]).toEqual({ type: 'tool-call-delta', index: 0, id: CallId(''), argumentsDelta: '{}' })
    expect(out[2]).toEqual({ type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(''), name: '', arguments: '{}' } })
  })

  it('ends the turn where the assistant message ends', async () => {
    expect(await chunks([
      event({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'first' } }),
      event({ type: 'content_block_stop', index: 0 }),
      event({ type: 'message_stop' }),
      // A vendor that keeps going belongs to the next call, not this one.
      event({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'second' } }),
    ])).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'first' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'first' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('passes over vendor events it has no projection for', async () => {
    expect(await chunks([
      { type: 'system', subtype: 'init' },
      event({ type: 'message_start', message: {} }),
      event({ type: 'ping' }),
      event({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      event({ type: 'content_block_stop', index: 0 }),
      event({ type: 'message_stop' }),
    ])).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('ignores a delta kind it carries no projection for', async () => {
    expect(await chunks([
      event({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      event({ type: 'content_block_delta', index: 0, delta: { type: 'citations_delta' } }),
      event({ type: 'content_block_stop', index: 0 }),
      { type: 'result', subtype: 'success' },
    ])).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })
})

describe('prompt rendering', () => {
  const ask = createUserMessage({ content: [{ type: 'text', text: 'list files' }], source: { kind: 'user' } }) as Message

  it('refuses a block that reaches the vendor through no path this adapter owns', () => {
    const withImage: Message = {
      ...ask,
      content: [{ type: 'image', attachment: { id: 'a', mediaType: 'image/png', width: 1, height: 1, byteLength: 1 } } as never],
    }
    expect(() => renderTranscript([withImage])).toThrow(LlmError)
    expect(() => renderTranscript([withImage])).toThrow(/cannot reach the vendor CLI/)
  })

  it('states prior turns as labelled text when no vendor session can resume', () => {
    const assistant: Message = {
      ...ask,
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'thinking' },
        { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{}' },
      ],
    }
    const result: Message = {
      ...ask,
      content: [{ type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: 'a.ts' }, { type: 'reasoning', text: 'x' }] }],
    }
    expect(renderTranscript([ask, assistant, result])).toBe(
      'user: list files\n\nassistant: [requested bash with {}]\n\nuser: [result of call-1]\na.ts\n[reasoning]',
    )
  })

  it('drops a message that renders to nothing', () => {
    const empty: Message = { ...ask, content: [{ type: 'reasoning', text: 'private' }] }
    expect(renderTranscript([empty])).toBe('')
  })
})

describe('resolveRoutes', () => {
  it('materializes the grace default once instead of at each request', () => {
    const routes = resolveRoutes({ claude: { models: [{ id: 'sonnet', contextWindow: 200_000 }] } })
    expect(routes.get('claude')).toMatchObject({
      provider: 'claude',
      displayName: 'claude',
      disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
    })
    expect(routes.get('claude')?.models.get('sonnet')).toEqual({ id: 'sonnet', contextWindow: 200_000 })
  })

  it('keeps what configuration stated', () => {
    const routes = resolveRoutes({ claude: { displayName: 'Claude', disposeGraceMs: 10 } })
    expect(routes.get('claude')).toMatchObject({ displayName: 'Claude', disposeGraceMs: 10 })
    expect(routes.get('claude')?.models.size).toBe(0)
  })
})
