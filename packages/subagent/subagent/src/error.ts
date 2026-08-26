/**
 * Typed failures shared by subagent service and provider operations.
 *
 * @module @arx-ai/arx-subagent
 */

import { HarnessError } from '@arx-ai/arx-llm'

/** Typed failure for the subagent seam. */
export class SubagentError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'SubagentError'
  }
}
