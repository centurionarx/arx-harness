/**
 * AUTH-005/v2 real native SDK + Replay + tool-fs fixture. This test helper
 * adds no product endpoint; both arms use the unchanged public RPC envelopes.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { InProcessApiClient } from '@arx-ai/arx-host-apiproxy'
import type { RpcResponse } from '@arx-ai/arx-host-apiproxy/api'
import type { SessionId } from '@arx-ai/arx-session/types'
import type { OwnerScope, RequestAuthority } from '@arx-ai/arx-web-identity'
import { installLlmReplay } from '@arx-ai/arx-llm-replay'
import { textResponse, toolCallResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'
import type { IsolatedProjectRuntime } from '../../packages/host/isolated-project-runtime/src/index.ts'
import type { nativeSupervisorFixture } from '../../packages/host/isolated-project-runtime/tests/native-supervisor.ts'

export type NativeBenchmarkArm = 'baseline' | 'candidate'
export type NativeFileOperation = 'read-file' | 'write-file'
export interface NativeToolBinding {
  readonly arm: NativeBenchmarkArm
  readonly supervisor: Awaited<ReturnType<typeof nativeSupervisorFixture>>
  readonly scope: OwnerScope
  readonly authority: RequestAuthority
  readonly sessionId: SessionId
  readonly volumePath: string
  readonly runtime: IsolatedProjectRuntime
}
function value<T>(response: RpcResponse<T>): T {
  if (!response.result.ok) throw new Error('native benchmark RPC failed: ' + JSON.stringify(response.result.error))
  return response.result.value
}

/** Compose the genuine SDK with the baseline or authenticated carrier. */
export async function nativeToolRunner(binding: NativeToolBinding) {
  const client = new InProcessApiClient({
    async fetch(input, init) {
      const request = new Request(input, init)
      if (binding.arm === 'candidate') return binding.runtime.fetch(binding.authority, request)
      // Fixture-operator binding, never a browser-supplied origin/path/owner.
      const path = new URL(request.url)
      const headers = new Headers(request.headers)
      headers.set('authorization', 'Bearer disposable-supervisor-fixture')
      headers.set('x-arx-operation-id', randomUUID())
      headers.set('x-arx-user-id', binding.scope.userId)
      headers.set('x-arx-project-id', binding.scope.projectId)
      headers.set('x-arx-workspace-id', binding.scope.workspaceId)
      return fetch(new URL(path.pathname + path.search, binding.supervisor.endpoint), {
        method: request.method, headers, signal: request.signal,
        ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: await request.text() }),
      })
    },
  })
  const created = value(await client.sessions.create({ sessionId: binding.sessionId }))
  if (created.sessionId !== binding.sessionId) throw new Error('native worker changed the owned session id')
  const ctx = binding.supervisor.ctxOf(binding.scope.workspaceId)
  if (ctx === undefined) throw new Error('native worker did not mount its real Loader graph')
  const agent = ctx.agents.get(binding.sessionId)
  if (agent === undefined) throw new Error('native worker did not create the real session agent')
  return {
    client, ctx, agent,
    /**
     * Install a finite real replay script. Warmups and measured turns consume
     * separate recorded calls; a missing/extra call fails assertConsumed.
     */
    async phase(operation: NativeFileOperation, turns: number, replayPath: string) {
      if (!Number.isSafeInteger(turns) || turns < 1) throw new Error('positive replay turn count required')
      const records: unknown[] = [{ type: 'session', id: 'recorded-native-benchmark', createdAt: 1 }]
      for (let turn = 0; turn < turns; turn++) {
        const args = operation === 'read-file'
          ? { file_path: 'file-' + String(turn) + '.txt' }
          : { file_path: 'file-' + String(turn) + '.txt', content: 'x'.repeat(1024) }
        const steps = [toolCallResponse('native-' + operation + '-' + String(turn),
          operation === 'read-file' ? 'read' : 'write', args), textResponse('Completed')]
        for (let step = 0; step < steps.length; step++) for (const chunk of present(steps[step])) {
          records.push({ type: 'assistant/chunk', data: { turn: turn + 1, step: step + 1, chunk } })
        }
      }
      await mkdir(dirname(replayPath), { recursive: true, mode: 0o700 })
      await writeFile(replayPath, records.map(row => JSON.stringify(row)).join('\n') + '\n', { mode: 0o600 })
      const replay = installLlmReplay(ctx, { file: replayPath,
        providers: [{ id: 'native-bench-replay', models: [{ id: 'native-bench-model' }] }] })
      let performed = 0
      const initialSeq = agent.session.seq
      try { value(await client.sessions.selectModel({ sessionId: binding.sessionId,
        provider: 'native-bench-replay', model: 'native-bench-model' })) }
      catch (error) { replay.dispose(); throw error }
      return {
        async perform(iteration: number) {
          if (iteration !== performed || iteration >= turns) throw new Error('native benchmark replay order changed')
          const seq = agent.session.seq
          value(await client.sessions.prompt({ sessionId: binding.sessionId, mode: 'queue',
            content: [{ type: 'text', text: 'Execute the recorded ' + operation + ' operation once' }] }))
          await agent.whenIdle()
          await ctx.sessions.flush(agent.session)
          const events = agent.session.events.slice(seq)
          const results = events.filter(event => event.type === 'tool/result')
          const end = events.findLast(event => event.type === 'turn/end')
          if (results.length !== 1 || present(results[0]).data.error !== undefined
            || end?.data.reason.kind !== 'completed') throw new Error('native filesystem turn did not complete exactly one successful tool')
          performed++
        },
        /** Check physical output and replay without adding an extra fsync path. */
        async verify() {
          if (performed !== turns) throw new Error('native benchmark did not execute every recorded turn')
          replay.assertConsumed()
          const events = agent.session.events.slice(initialSeq)
          if (events.filter(event => event.type === 'tool/call').length !== turns
            || events.filter(event => event.type === 'tool/result').length !== turns) throw new Error('native filesystem tool count changed')
          for (let file = 0; file < turns; file++) {
            const content = await readFile(join(binding.volumePath, 'file-' + String(file) + '.txt'))
            if (content.length !== 1024
              || !content.equals(Buffer.from('x'.repeat(1024)))) throw new Error('native filesystem workload changed')
          }
          return { turns, toolCalls: turns, modelCalls: turns * 2, replayConsumed: true,
            nativeCheckpointFlushed: true, firstSequence: initialSeq, nextSequence: agent.session.seq }
        },
        dispose() { replay.dispose() },
      }
    },
  }
}

function present<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('required native fixture value missing')
  return value
}
