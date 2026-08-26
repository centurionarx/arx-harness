/**
 * Rendering of harness messages into what the vendor CLI accepts as input.
 *
 * @module @centurionarx/cxh-llm-agent-cli/prompt
 */

import { LlmError, type ContentBlock, type Message } from '@centurionarx/cxh-llm'

/** Anthropic content blocks the vendor CLI accepts on a user message. */
type VendorContent =
  | { type: 'text'; text: string }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

/** One user-role message shaped for the vendor CLI's input stream. */
export interface VendorUserMessage {
  readonly type: 'user'
  readonly message: { role: 'user'; content: VendorContent[] }
  readonly parent_tool_use_id: null
}

/** Flatten a tool result's own blocks into the text the vendor carries. */
function toolResultText(content: readonly ContentBlock[]): string {
  return content.map(block => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
}

/**
 * Convert one harness message into vendor content blocks.
 *
 * An image reaches the vendor CLI through no path this adapter owns, so it
 * fails loudly rather than being dropped into a request the model would then
 * answer without it.
 * @param message - one assembled harness message.
 * @returns the vendor content blocks for that message.
 */
function vendorContent(message: Message): VendorContent[] {
  return message.content.map((block) => {
    switch (block.type) {
      case 'text':
        return { type: 'text' as const, text: block.text }
      case 'tool-result':
        return {
          type: 'tool_result' as const,
          tool_use_id: block.toolCallId,
          content: toolResultText(block.content),
          ...block.isError === undefined ? {} : { is_error: block.isError },
        }
      default:
        throw new LlmError(
          `llm-agent-cli: a ${block.type} block cannot reach the vendor CLI`,
          'UNSUPPORTED_CONTENT',
        )
    }
  })
}

/**
 * Shape the delta a resumed vendor session must receive.
 *
 * Only user-role messages are representable: the vendor session already holds
 * its own assistant turns, and this input stream carries no assistant role.
 * @param messages - the messages this request adds to the vendor session.
 * @returns one vendor user message per deliverable harness message.
 */
export function toVendorMessages(messages: readonly Message[]): VendorUserMessage[] {
  return messages
    .filter(message => message.role === 'user')
    .map(message => ({
      type: 'user' as const,
      message: { role: 'user' as const, content: vendorContent(message) },
      parent_tool_use_id: null,
    }))
}

/**
 * Render a whole transcript for a vendor session that cannot resume.
 *
 * A fresh vendor session accepts no assistant turns, so replay states them as
 * labelled text. This is the lossy path, and it is why session affinity
 * exists: role structure and the vendor's own prompt cache are both lost here.
 * @param messages - the request's complete assembled history.
 * @returns one prompt string describing the conversation so far.
 */
export function renderTranscript(messages: readonly Message[]): string {
  const rendered = messages.map((message) => {
    const body = message.content.map((block) => {
      switch (block.type) {
        case 'text':
          return block.text
        case 'reasoning':
          return ''
        case 'tool-call':
          return `[requested ${block.name} with ${block.arguments}]`
        case 'tool-result':
          return `[result of ${block.toolCallId}]\n${toolResultText(block.content)}`
        default:
          throw new LlmError(
            `llm-agent-cli: a ${block.type} block cannot reach the vendor CLI`,
            'UNSUPPORTED_CONTENT',
          )
      }
    }).filter(text => text.length > 0).join('\n')
    return body.length === 0 ? '' : `${message.role}: ${body}`
  })
  return rendered.filter(text => text.length > 0).join('\n\n')
}
