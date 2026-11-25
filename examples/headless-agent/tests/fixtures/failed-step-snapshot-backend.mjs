/**
 * Deterministic provider adapter and one-shot scheduler fault for the headless
 * failed-step snapshot. The first model response requests two exclusive `bash`
 * calls; the first dispatch fails inside the real tool-call scheduler, so the
 * second call never starts. After that turn ends with its error, the fixture
 * sends one continuation, and the adapter refuses the second request unless
 * the failed step's recovery results follow its assistant message.
 */

import { LlmAdapter, createUserMessage } from '@arx-ai/arx-llm'
import { TOOL_RUNTIME_SCHEDULER } from '@arx-ai/arx-tools'

const CALLS = [
  { id: 'call-first', command: 'printf first', resultText: 'Its outcome is unknown.' },
  { id: 'call-second', command: 'printf second', resultText: 'before the Harness recorded it as started' },
]

/**
 * Refuse a request whose history does not answer each failed-step call with
 * its recovery result directly after the assistant message.
 * @param {readonly import('@arx-ai/arx-llm').Message[]} messages - the request history.
 */
function assertRecoveryResults(messages) {
  const assistant = messages.findIndex(message => message.content.some(block => block.type === 'tool-call'))
  const results = messages.slice(assistant + 1, assistant + 1 + CALLS.length).map(message => message.content[0])
  const answered = assistant >= 0 && results.length === CALLS.length && results.every((block, index) =>
    block?.type === 'tool-result'
    && block.toolCallId === CALLS[index].id
    && block.isError === true
    && block.content.some(part => part.type === 'text' && part.text.includes(CALLS[index].resultText)))
  if (!answered) throw new Error('failed-step snapshot request lacks the recovery results')
}

class FailedStepSnapshotAdapter extends LlmAdapter {
  requests = 0

  async * stream(options) {
    this.requests++
    if (this.requests === 1) {
      for (const [index, call] of CALLS.entries()) {
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield {
          type: 'block-end',
          index,
          block: { type: 'tool-call', id: call.id, name: 'bash', arguments: JSON.stringify({ command: call.command }) },
        }
      }
      yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    assertRecoveryResults(options.messages)
    const text = 'RECOVERY_OK'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Cordis plugin name. */
export const name = 'failed-step-snapshot-backend'
/** Required LLM registry and tool runtime services. */
export const inject = ['llm', 'tools']

/**
 * Register the adapter, fail the first scheduler dispatch, and continue once
 * after the failed turn.
 * @param {import('@arx-ai/cordis').Context} ctx - plugin context carrying the LLM and tool services.
 */
export function apply(ctx) {
  ctx.llm.registerAdapter(['deepseek-official'], new FailedStepSnapshotAdapter())

  // The tool runtime turns tool failures into results; only its internal
  // scheduler view can fail the step the way an internal fault does.
  const scheduler = ctx.tools[TOOL_RUNTIME_SCHEDULER]
  const dispatch = scheduler.dispatch
  let faulted = false
  scheduler.dispatch = (exec) => {
    if (faulted) return dispatch(exec)
    faulted = true
    return Promise.reject(new Error('snapshot scheduler fault'))
  }
  ctx.effect(() => () => { scheduler.dispatch = dispatch }, 'failed-step-snapshot-backend: scheduler fault')

  let failedSession
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end' && event.data.reason.kind === 'error') failedSession = session
  }, { global: true })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || agent.session !== failedSession) return
    failedSession = undefined
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Continue from the failed step.' }],
      source: { kind: 'user' },
    }))
  })
}
