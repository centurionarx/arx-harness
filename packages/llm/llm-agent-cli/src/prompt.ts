/**
 * Rendering of harness messages into the one user message that opens a vendor
 * run.
 *
 * @module @arx-ai/arx-llm-agent-cli/prompt
 */

import type { AttachmentId, ImageAttachmentRef, RequestImageAttachment } from '@arx-ai/arx-attachment'
import { LlmError, type ContentBlock, type Message } from '@arx-ai/arx-llm'

/** Content blocks the vendor CLI accepts on a user message. */
export type VendorContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/**
 * The guardrail that precedes every replayed transcript. The record notation
 * below is the only place on this route where a tool call appears as text the
 * model can continue, and a model that continues the transcript in prose
 * instead of emitting a tool_use block "calls" a tool nobody executes — the
 * user then reads the call's JSON interleaved with the answer. Naming the
 * records archival and naming the real mechanism is the correction available
 * at this seam; trailing records that still slip through are converted back
 * into tool calls by the stream repair.
 */
export const TRANSCRIPT_PREAMBLE =
  'Tool requests below appear as records like [requested run_code with {...}], and tool'
  + ' results as [result of ID]. These are entries the harness already executed, kept to show'
  + ' what happened; they are not an output format. To call a tool now, emit a real tool call'
  + ' through your tool-calling mechanism, and never write record lines of this form in your answer.'

/** Flatten a tool result's own blocks into the text the vendor carries. */
function toolResultText(content: readonly ContentBlock[]): string {
  return content.map(block => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
}

/**
 * Every image attachment one request references, in first-appearance order.
 * @param messages - the request's complete assembled history.
 * @returns the distinct references, keyed by attachment id.
 */
export function collectImageRefs(messages: readonly Message[]): ReadonlyMap<AttachmentId, ImageAttachmentRef> {
  const refs = new Map<AttachmentId, ImageAttachmentRef>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'image') continue
      const { attachment } = block
      if (!refs.has(attachment.attachmentId)) refs.set(attachment.attachmentId, attachment)
    }
  }
  return refs
}

/**
 * Render a whole transcript as the content of the one user message that opens
 * a vendor run.
 *
 * Every call opens its own run, and a run accepts no assistant turns, so prior
 * turns are stated as labelled text. Images stay images: they ride as their own
 * blocks, in the position their text occupied, so the model reads them where
 * they were attached rather than as a footnote. {@link TRANSCRIPT_PREAMBLE}
 * rides ahead of whichever content lands first, naming the record notation
 * archival so the model does not imitate it instead of emitting tool calls.
 * @param messages - the request's complete assembled history.
 * @param images - request versions for every referenced attachment, keyed by attachment id.
 * @returns the ordered content blocks describing the conversation so far.
 */
export function renderTranscript(
  messages: readonly Message[],
  images: ReadonlyMap<AttachmentId, RequestImageAttachment> = new Map(),
): readonly VendorContent[] {
  const out: VendorContent[] = []
  let pending: string[] = []
  const flush = (): void => {
    const text = pending.join('\n\n')
    pending = []
    if (text.length > 0) out.push({ type: 'text', text })
  }

  for (const message of messages) {
    const body: string[] = []
    const carried: VendorContent[] = []
    for (const block of message.content) {
      switch (block.type) {
        case 'text':
          body.push(block.text)
          break
        case 'reasoning':
          break
        case 'tool-call':
          body.push(`[requested ${block.name} with ${block.arguments}]`)
          break
        case 'tool-result':
          body.push(`[result of ${block.toolCallId}]\n${toolResultText(block.content)}`)
          break
        case 'image': {
          const version = images.get(block.attachment.attachmentId)
          if (version === undefined) {
            throw new LlmError(
              `llm-agent-cli: image ${block.attachment.attachmentId} has no request version`,
              'UNSUPPORTED_CONTENT',
            )
          }
          carried.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: version.mediaType,
              data: Buffer.from(version.data).toString('base64'),
            },
          })
          break
        }
        default:
          throw new LlmError(
            `llm-agent-cli: a ${(block as ContentBlock).type} block cannot reach the vendor CLI`,
            'UNSUPPORTED_CONTENT',
          )
      }
    }
    const text = body.filter(part => part.length > 0).join('\n')
    if (text.length > 0) pending.push(`${message.role}: ${text}`)
    if (carried.length > 0) {
      flush()
      out.push(...carried)
    }
  }
  flush()
  // The guardrail rides ahead of whichever content came first: merged into a
  // leading text block, or its own block when the transcript opens with a
  // carried image.
  const first = out[0]
  if (first !== undefined) {
    out[0] = first.type === 'text'
      ? { type: 'text', text: `${TRANSCRIPT_PREAMBLE}\n\n${first.text}` }
      : { type: 'text', text: TRANSCRIPT_PREAMBLE }
  }
  return out
}
