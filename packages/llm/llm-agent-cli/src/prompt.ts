/**
 * Rendering of harness messages into what the vendor CLI accepts as input.
 *
 * @module @arx-ai/arx-llm-agent-cli/prompt
 */

import { LlmError, type ContentBlock, type Message } from '@arx-ai/arx-llm'

/** Flatten a tool result's own blocks into the text the vendor carries. */
function toolResultText(content: readonly ContentBlock[]): string {
  return content.map(block => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
}

/**
 * Render a whole transcript as the prompt opening one vendor run.
 *
 * Every call opens its own run, and a run accepts no assistant turns, so prior
 * turns are stated as labelled text. Role structure and the vendor's prompt
 * cache are both lost here; that cost is what buys a run that cannot be left
 * holding a tool call the harness answered too late.
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
