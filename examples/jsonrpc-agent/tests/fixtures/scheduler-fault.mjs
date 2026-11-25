/**
 * SDK snapshot fixture: fail the first tool dispatch inside the real
 * tool-call scheduler. The tool runtime turns tool failures into results, so
 * only its internal scheduler view can fail a step the way an internal fault
 * does.
 */

import { TOOL_RUNTIME_SCHEDULER } from '@arx-ai/arx-tools'

/** Cordis plugin name. */
export const name = 'scheduler-fault'
/** Required tool runtime service. */
export const inject = ['tools']

/**
 * Reject the first scheduler dispatch, then delegate every later one.
 * @param {import('@arx-ai/cordis').Context} ctx - plugin context carrying the tool runtime.
 */
export function apply(ctx) {
  const scheduler = ctx.tools[TOOL_RUNTIME_SCHEDULER]
  const dispatch = scheduler.dispatch
  let faulted = false
  scheduler.dispatch = (exec) => {
    if (faulted) return dispatch(exec)
    faulted = true
    return Promise.reject(new Error('snapshot scheduler fault'))
  }
  ctx.effect(() => () => { scheduler.dispatch = dispatch }, 'scheduler-fault: dispatch')
}
