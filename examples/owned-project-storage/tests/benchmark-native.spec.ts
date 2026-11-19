/**
 * Functional native benchmark-driver gate. Its two turns are a smoke test;
 * they do not replace AUTH-005/v2's fixed 5+100 timing workload.
 */
import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import { storageHarness } from '../../../packages/identity/project-storage/tests/harness.ts'
import { oneTurnLog } from '../../../packages/session/session-persistence/tests/contract.ts'
import { nativeSupervisorFixture } from '../../../packages/host/isolated-project-runtime/tests/native-supervisor.ts'
import * as BrokerHttp from '../../../packages/host/isolated-project-runtime/src/broker-http.ts'
import { nativeToolRunner } from '../benchmark-native-tools.ts'

let h: Awaited<ReturnType<typeof storageHarness>>
let candidate: Awaited<ReturnType<typeof nativeSupervisorFixture>>
let baseline: Awaited<ReturnType<typeof nativeSupervisorFixture>>
const runners: Awaited<ReturnType<typeof nativeToolRunner>>[] = []
beforeAll(async () => {
  candidate = await nativeSupervisorFixture({ fsTools: true })
  h = await storageHarness({ endpoint: candidate.endpoint, http: true,
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
  baseline = await nativeSupervisorFixture({ fsTools: true, baseline: { logRoot: h.logRoot, compression: 'none' } })
  await mkdir(join(h.paths.root, 'replays'), { mode: 0o700 })
  for (let user = 0; user < 2; user++) {
    const authority = h.users[user]!.authority
    const project = await h.ctx.projectStorage.createProject(authority, 'Native benchmark ' + String(user))
    const workspace = await h.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Native benchmark ' + String(user))
    const provision = await h.ctx.projectStorage.provision(authority, workspace.workspaceId)
    for (let file = 0; file < 2; file++) await writeFile(join(provision.volumePath, 'file-' + String(file) + '.txt'), 'x'.repeat(1024))
    for (const [arm, supervisor] of [['baseline', baseline], ['candidate', candidate]] as const) {
      supervisor.assign({ controlOrigin: h.url!, scope: provision.scope, volumePath: provision.volumePath })
      const header = await h.ctx.projectStorage.register(authority, workspace.workspaceId,
        { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: 1 })
      await h.ctx.projectStorage.append(authority, header.id, oneTurnLog())
      runners.push(await nativeToolRunner({ arm, supervisor, scope: provision.scope, authority,
        volumePath: provision.volumePath, sessionId: header.id, runtime: h.ctx.isolatedProjectRuntime }))
    }
  }
})
afterAll(async () => { await baseline?.close(); await h?.close(); await candidate?.close() })
it.each(['read-file', 'write-file'] as const)('executes %s through the real SDK/Replay/tool-fs in both arms for both USERs',
  async (operation) => {
    const phases = await Promise.all(runners.map((runner, index) =>
      runner.phase(operation, 2, join(h.paths.root, 'replays', String(index) + '-' + operation + '.jsonl'))))
    try {
      await Promise.all(phases.map(async (phase) => { await phase.perform(0); await phase.perform(1) }))
      for (const phase of phases) expect(await phase.verify()).toMatchObject({
        turns: 2, toolCalls: 2, modelCalls: 4, replayConsumed: true, nativeCheckpointFlushed: true,
      })
      // Counters wrap the genuine services with next(); no mocked tool/LLM result.
      const factor = operation === 'read-file' ? 1 : 2
      expect(candidate.counts).toEqual({ modelCalls: 8 * factor, toolCalls: 4 * factor })
      expect(baseline.counts).toEqual({ modelCalls: 8 * factor, toolCalls: 4 * factor })
    } finally { for (const phase of phases) phase.dispose() }
  })
