/** Assistant block classifier (moved here with sessions/conversation.ts). */

import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@arx-ai/arx-attachment'
import type { ContentBlock } from '@arx-ai/arx-api-remotes/client'
import { toAssistantBlock, toAssistantBlocks } from '../src/client/sessions/conversation.ts'

describe('toAssistantBlock', () => {
  it('classifies the four block shapes', () => {
    const attachment = {
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
      mediaType: 'image/png' as const,
      bytes: 68,
      width: 1,
      height: 1,
    }
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'corpo do texto' },
      { type: 'reasoning', text: 'raciocínio' },
      { type: 'tool-call', id: 'c1', name: 'echo', arguments: '{}' } as ContentBlock,
      { type: 'image', attachment },
    ]
    expect(toAssistantBlocks(blocks)).toEqual([
      { kind: 'text', text: 'corpo do texto' },
      { kind: 'reasoning', text: 'raciocínio' },
      { kind: 'tool-call', callId: 'c1', name: 'echo', argsRaw: '{}' },
      { kind: 'image', attachment },
    ])
    expect(toAssistantBlock(blocks[0] as ContentBlock)).toEqual({ kind: 'text', text: 'corpo do texto' })
  })
})
