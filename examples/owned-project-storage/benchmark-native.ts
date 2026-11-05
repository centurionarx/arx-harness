/**
 * AUTH-005/v2 fixed-workload keyless native driver.
 * Run only in the parent's agreed idle window through run-gate-isolated.py.
 * Usage: benchmark-native.ts <output> <none|zstd> <baseline-provenance>.
 * No service, infrastructure, account, secret or product endpoint is created.
 */
import { mkdtemp, mkdir, writeFile, readFile, rm, statfs } from 'node:fs/promises'
import { tmpdir, cpus, totalmem, platform, release } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import type { SessionEvent, SessionHeader } from '@arx-ai/arx-session'
import { MessageId, freezeMessage } from '@arx-ai/arx-llm'
import type { OwnerScope, RequestAuthority } from '@arx-ai/arx-web-identity'
import { eventLines, toHeaderLine } from '../../packages/session/session-persistence-jsonl/src/format.ts'
import { storageHarness } from '../../packages/identity/project-storage/tests/harness.ts'
import { nativeSupervisorFixture } from '../../packages/host/isolated-project-runtime/tests/native-supervisor.ts'
import * as BrokerHttp from '../../packages/host/isolated-project-runtime/src/broker-http.ts'
import { nativeToolRunner } from './benchmark-native-tools.ts'
import type { NativeBenchmarkArm } from './benchmark-native-tools.ts'

const WORKLOAD = Object.freeze({ users: 2, sessionsPerUser: 1000, largeLogBytes: 10 * 1024 * 1024,
  smallLogMaxBytes: 1024, filesPerUser: 10000, fileBytes: 1024, pageHeaders: 50,
  historyPageBytes: 128 * 1024, appendBytes: 1024, warmups: 5, samplesPerUserPerArm: 100 })
const compression = process.argv[3]
if (compression !== 'none' && compression !== 'zstd') throw new Error('explicit none or zstd encoding required')
if (process.argv[2] === undefined || process.argv[2] === '') throw new Error('explicit evidence output directory required')
const output = resolve(process.argv[2])
const provenancePath = process.argv[4]
if (provenancePath === undefined || provenancePath === '') throw new Error('explicit baseline provenance path required')
const root = await mkdtemp(join(tmpdir(), 'arx-auth005-native-'))
const operations = ['list', 'open', 'append', 'read-file', 'write-file'] as const
type Operation = typeof operations[number]
interface BaselineProvenance {
  version: string
  baseCommit: string
  beforeLedger: { path: string; sha256: string }
  classes: Record<Operation, {
    baseline: { methods: string[]; paths: string[] }
    candidate: { methods: string[]; paths: string[] }
  }>
}
const baselineProvenance = JSON.parse(await readFile(provenancePath, 'utf8')) as BaselineProvenance
if (baselineProvenance.version !== 'AUTH-005/v2-baseline-provenance'
  || baselineProvenance.baseCommit !== '1e5309f133c8a09599fc90cfc003a1556677895b'
  || baselineProvenance.beforeLedger.sha256 !== '0ee720d7ebba7c7a6c102cca195f88aa187d6c48b23d9542fc414996f5317d0a'
  || createHash('sha256').update(await readFile(baselineProvenance.beforeLedger.path)).digest('hex')
    !== baselineProvenance.beforeLedger.sha256) throw new Error('pre-implementation baseline provenance unavailable or changed')
type Sample = { arm: NativeBenchmarkArm
  operation: Operation
  user: number
  iteration: number
  warmup: boolean
  milliseconds: number }
type Runner = Awaited<ReturnType<typeof nativeToolRunner>>
type User = { authority: RequestAuthority
  scope: OwnerScope
  volume: string
  sessions: SessionHeader[]
  sequences: Record<NativeBenchmarkArm, number>
  turns: Record<NativeBenchmarkArm, number>
  runners: Record<NativeBenchmarkArm, Runner> }
const raw: Sample[] = [], phases: unknown[] = [], witnesses: unknown[] = []
let h: Awaited<ReturnType<typeof storageHarness>> | undefined
let candidate: Awaited<ReturnType<typeof nativeSupervisorFixture>> | undefined
let baseline: Awaited<ReturnType<typeof nativeSupervisorFixture>> | undefined
const users: User[] = []
const delay = monitorEventLoopDelay({ resolution: 10 })
function events(text: string, start = 0, turn = 1): SessionEvent[] {
  return [
    { type: 'turn/start', seq: start, time: 1, data: { turn } },
    { type: 'user/message', seq: start + 1, time: 2, surfaceOp: 'append',
      data: freezeMessage({ id: MessageId('bench-' + String(turn)), role: 'user',
        content: [{ type: 'text', text }], source: { kind: 'user' } }) },
    { type: 'turn/end', seq: start + 2, time: 3, data: { turn, reason: { kind: 'completed' } } },
  ]
}
function pseudoText(bytes: number): string {
  const buffer = Buffer.allocUnsafe(bytes); let state = 0x7621f13d
  for (let i = 0; i < bytes; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; buffer[i] = 65 + (state >>> 0) % 26 }
  return buffer.toString('ascii')
}
function percentile(values: readonly number[], fraction: number): number {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.ceil(ordered.length * fraction) - 1] ?? 0
}
async function io(): Promise<Record<string, string> | { unavailable: true }> {
  try {
    const source = await readFile('/proc/self/io', 'utf8')
    return Object.fromEntries(source.trim().split('\n').map((line) => { const [key,
      value] = line.split(':'); return [present(key), present(value).trim()] }))
  } catch { return { unavailable: true } }
}
async function timed(arm: NativeBenchmarkArm, operation: Operation, user: number, iteration: number, work: () => Promise<void>) {
  const start = performance.now()
  await work()
  raw.push({ arm, operation, user, iteration: iteration < WORKLOAD.warmups ? iteration : iteration - WORKLOAD.warmups,
    warmup: iteration < WORKLOAD.warmups, milliseconds: performance.now() - start })
}
async function hashes(): Promise<Record<string, string>> {
  const files = [
    'packages/session/session-persistence-jsonl/src/index.ts',
    'packages/session/session-persistence/src/coordinator.ts',
    'packages/fs/fs-local/src/fsio.ts', 'packages/fs/tool-fs/src/index.ts',
    'packages/host/apiproxy/src/fetch/client.ts', 'packages/test-support/llm-replay/src/index.ts',
    'packages/identity/project-storage/src/index.ts', 'packages/host/isolated-project-runtime/src/index.ts',
    'packages/host/isolated-project-runtime/src/worker-persistence.ts',
    'packages/host/isolated-project-runtime/tests/native-supervisor.ts',
    'examples/owned-project-storage/benchmark-native-tools.ts', 'examples/owned-project-storage/benchmark-native.ts',
  ]
  return Object.fromEntries(await Promise.all(files.map(async file => [file,
    createHash('sha256').update(await readFile(file)).digest('hex')] as const)))
}
try {
  await mkdir(output, { recursive: true, mode: 0o700 })
  candidate = await nativeSupervisorFixture({ fsTools: true })
  h = await storageHarness({ root, initialize: true, readyUsers: 2, compression, endpoint: candidate.endpoint, http: true,
    extraPlugins: [{ name: '@arx-ai/arx-isolated-project-runtime/broker-http', plugin: BrokerHttp }] })
  baseline = await nativeSupervisorFixture({ fsTools: true, baseline: { logRoot: h.logRoot, compression } })
  const giant = pseudoText(WORKLOAD.largeLogBytes)
  const seeded = await Promise.all(h.users.map(async (issuer, userIndex) => {
    const authority = issuer.authority
    const project = await present(h).ctx.projectStorage.createProject(authority, 'AUTH005 ' + String(userIndex))
    const workspace = await present(h).ctx.projectStorage.createWorkspace(authority, project.projectId, 'AUTH005 ' + String(userIndex))
    const provision = await present(h).ctx.projectStorage.provision(authority, workspace.workspaceId)
    const sessions: SessionHeader[] = []
    for (let index = 0; index < WORKLOAD.sessionsPerUser; index++) {
      const header = await present(h).ctx.projectStorage.register(authority, workspace.workspaceId,
        { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: index })
      const size = WORKLOAD.largeLogBytes - Buffer.byteLength(JSON.stringify(toHeaderLine(header))) - 1
        - Buffer.byteLength(eventLines(events(''), true)) - 1
      await present(h).ctx.projectStorage.append(authority, header.id, events(index === 0 ? giant.slice(0, size) : 'small'))
      const artifact = await present(h).ctx.sessionPersistence.readRaw(header.id)
      if (artifact === undefined || (index === 0 ? Buffer.byteLength(artifact.content) !== WORKLOAD.largeLogBytes
        : Buffer.byteLength(artifact.content) > WORKLOAD.smallLogMaxBytes)) throw new Error('exact log workload was not materialized')
      sessions.push(header)
      if (index % 250 === 0) process.stdout.write(JSON.stringify({ stage: 'seed', user: userIndex, sessions: index + 1 }) + '\n')
    }
    for (let file = 0; file < WORKLOAD.filesPerUser; file++) {
      await writeFile(join(provision.volumePath, 'file-' + String(file) + '.txt'), 'x'.repeat(WORKLOAD.fileBytes), { mode: 0o600 })
    }
    present(baseline).assign({ controlOrigin: present(present(h).url), scope: provision.scope, volumePath: provision.volumePath })
    present(candidate).assign({ controlOrigin: present(present(h).url), scope: provision.scope, volumePath: provision.volumePath })
    const baselineRunner = await nativeToolRunner({ arm: 'baseline', supervisor: present(baseline), scope: provision.scope, authority,
      sessionId: present(sessions[3]).id, volumePath: provision.volumePath, runtime: present(h).ctx.isolatedProjectRuntime })
    const candidateRunner = await nativeToolRunner({ arm: 'candidate', supervisor: present(candidate), scope: provision.scope, authority,
      sessionId: present(sessions[4]).id, volumePath: provision.volumePath, runtime: present(h).ctx.isolatedProjectRuntime })
    return { authority, scope: provision.scope, volume: provision.volumePath, sessions,
      sequences: { baseline: 3, candidate: 3 }, turns: { baseline: 2, candidate: 2 },
      runners: { baseline: baselineRunner, candidate: candidateRunner } } satisfies User
  }))
  users.push(...seeded)
  if (users.length !== WORKLOAD.users) throw new Error('benchmark must contain exactly two real USERs')
  const countsBefore = { baseline: baseline.counts, candidate: candidate.counts }
  const memoryBefore = process.memoryUsage(), cpuBefore = process.cpuUsage(), ioBefore = await io()
  for (const operation of operations) {
    const native = operation === 'read-file' || operation === 'write-file'
      ? await Promise.all(users.map((user, index) => Promise.all((['baseline', 'candidate'] as const).map(arm =>
        user.runners[arm].phase(operation, WORKLOAD.warmups + WORKLOAD.samplesPerUserPerArm,
          join(root, 'replays', String(index) + '-' + arm + '-' + operation + '.jsonl'))))))
      : undefined
    delay.reset(); delay.enable()
    const start = performance.now(), cpuStart = process.cpuUsage(), ioStart = await io()
    try {
      await Promise.all(users.map(async (user, userIndex) => {
        for (let iteration = 0; iteration < WORKLOAD.warmups + WORKLOAD.samplesPerUserPerArm; iteration++) {
          const order: readonly NativeBenchmarkArm[] = iteration % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']
          for (const arm of order) await timed(arm, operation, userIndex, iteration, async () => {
            const persistence = present(h).ctx.sessionPersistence
            if (operation === 'list') {
              if (arm === 'baseline') {
                const list = (await persistence.list()).filter(meta => meta.cwd === user.volume)
                  .sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, WORKLOAD.pageHeaders)
                if (list.length !== WORKLOAD.pageHeaders) throw new Error('baseline metadata workload changed')
              } else {
                const page = await present(h).ctx.projectStorage.list(user.authority, { kind: 'workspace',
                  workspaceId: user.scope.workspaceId })
                if (page.sessions.length !== WORKLOAD.pageHeaders) throw new Error('candidate metadata workload changed')
              }
            } else if (operation === 'open') {
              if (arm === 'baseline') {
                const artifact = await persistence.readRaw(present(user.sessions[0]).id)
                if (artifact === undefined || Buffer.byteLength(artifact.content.slice(0,
                  WORKLOAD.historyPageBytes)) !== WORKLOAD.historyPageBytes) {
                  throw new Error('baseline large-log workload changed')
                }
              } else {
                const page = await present(h).ctx.projectStorage.read(user.authority, present(user.sessions[0]).id)
                if (Buffer.byteLength(JSON.stringify(page)) > WORKLOAD.historyPageBytes
                  || page.nextCursor === undefined) throw new Error('candidate history page contract changed')
              }
            } else if (operation === 'append') {
              const seq = user.sequences[arm], turn = user.turns[arm]++
              const bytes = WORKLOAD.appendBytes - Buffer.byteLength(eventLines(events('', seq, turn), true)) - 1
              const batch = events('x'.repeat(bytes), seq, turn)
              if (Buffer.byteLength(eventLines(batch,
                true)) + 1 !== WORKLOAD.appendBytes) throw new Error('durable append is not exactly 1 KiB')
              const id = present(user.sessions[arm === 'baseline' ? 1 : 2]).id
              if (arm === 'baseline') await persistence.append(id, batch)
              else await present(h).ctx.projectStorage.append(user.authority, id, batch)
              user.sequences[arm] += batch.length
            } else {
              await present(present(present(native)[userIndex])[arm === 'baseline' ? 0 : 1]).perform(iteration)
            }
          })
        }
      }))
      const elapsed = performance.now() - start
      delay.disable()
      phases.push({ operation, milliseconds: elapsed,
        operationsIncludingWarmups: WORKLOAD.users * 2 * (WORKLOAD.warmups + WORKLOAD.samplesPerUserPerArm),
        throughputIncludingWarmups: WORKLOAD.users * 2 * (WORKLOAD.warmups + WORKLOAD.samplesPerUserPerArm) / (elapsed / 1000),
        cpu: process.cpuUsage(cpuStart), memory: process.memoryUsage(), io: { before: ioStart, after: await io() },
        eventLoop: { p50Ms: delay.percentile(50) / 1e6, p95Ms: delay.percentile(95) / 1e6, maxMs: delay.max / 1e6 } })
      if (native !== undefined) for (let user = 0; user < native.length; user++) for (let arm = 0; arm < 2; arm++) {
        witnesses.push({ operation, user, arm: arm === 0 ? 'baseline' : 'candidate',
          ...await present(present(native[user])[arm]).verify() })
      }
      process.stdout.write(JSON.stringify({ stage: 'phase-complete', operation, milliseconds: elapsed }) + '\n')
    } finally { delay.disable(); if (native !== undefined) for (const pair of native) for (const fixture of pair) fixture.dispose() }
  }
  const expectedTools = WORKLOAD.users * 2 * (WORKLOAD.warmups + WORKLOAD.samplesPerUserPerArm)
  for (const [arm, supervisor] of [['baseline', baseline], ['candidate', candidate]] as const) {
    const before = countsBefore[arm], after = supervisor.counts
    if (after.toolCalls - before.toolCalls !== expectedTools
      || after.modelCalls - before.modelCalls !== expectedTools * 2) throw new Error('unexpected model/tool execution in native benchmark')
  }
  for (const user of users) for (const arm of ['baseline', 'candidate'] as const) {
    const id = present(user.sessions[arm === 'baseline' ? 1 : 2]).id
    if ((await h.ctx.sessionPersistence.readFrom(id,
      0)).events.length !== user.sequences[arm]) throw new Error('durable append receipt and stored sequence differ')
    const runner = user.runners[arm]
    const stored = await runner.ctx.sessionPersistence.readFrom(runner.agent.session.id, 0)
    if (stored.events.length !== runner.agent.session.seq) throw new Error('native worker checkpoint was not durably persisted')
  }
  const report = operations.map((operation) => {
    const rows = (arm: NativeBenchmarkArm) => raw.filter(sample => !sample.warmup
      && sample.operation === operation && sample.arm === arm).map(sample => sample.milliseconds)
    const base = rows('baseline'), next = rows('candidate')
    if (base.length !== WORKLOAD.users * WORKLOAD.samplesPerUserPerArm
      || next.length !== base.length) throw new Error('required timing sample count changed')
    const baselineP95 = percentile(base, 0.95), candidateP95 = percentile(next, 0.95), ratio = candidateP95 / baselineP95
    const localBoundPassed = !['list', 'open'].includes(operation) || candidateP95 <= 500
    return { operation, comparable: true, flows: baselineProvenance.classes[operation], samplesEach: base.length,
      baseline: { p50: percentile(base, 0.5), p95: baselineP95 }, candidate: { p50: percentile(next, 0.5), p95: candidateP95 },
      ratio, regressionPassed: ratio <= 1.10, localBoundPassed, status: ratio > 1.10 || !localBoundPassed ? 'FAIL' : 'PASS' }
  })
  const filesystem = await statfs(root, { bigint: true })
  const finishMemory = process.memoryUsage(), finishCpu = process.cpuUsage(cpuBefore), finishIo = await io()
  const shutdownStart = performance.now()
  await h.ctx.isolatedProjectRuntime.quiesce()
  await baseline.close(); baseline = undefined
  await candidate.close(); candidate = undefined
  const quiescence = { milliseconds: performance.now() - shutdownStart, cancelReceiptAwaited: true, contextsDisposed: true,
    limitation: 'actual Loader Context disposal and fixture peer receipt; not a production OS process-tree, UID, mount or network-isolation gate' }
  const blockers = report.filter(row => row.status !== 'PASS').map(row => row.operation + ' exceeds an approved performance gate')
  blockers.push('FSLocal atomic writes file.sync then rename but do not fsync the directory; crash-durable directory publication remains unproven')
  blockers.push('production worker topology, separate UID/mount/network policy and CPU/RAM quotas are not provisioned or verified by this native fixture')
  const result = {
    version: 'AUTH-005/v2-native', baselineVersion: '1.0.40', baselineCommit: '1e5309f133c8a09599fc90cfc003a1556677895b',
    node: process.version, sourcesSha256: await hashes(), baselineProvenance, workload: WORKLOAD, compression,
    equivalence: { storage: 'same JSONL provider, physical files/disk and encoding, distinct equally seeded session ids per arm; two USER tasks parallel, alternating arms',
      append: 'both use existing fsync and directory-sync JSONL provider; candidate additionally revalidates ownership and commits SQLite FULL index',
      readWrite: 'same genuine SDK, Loader/AgentLoop, Replay calls, checkpoint policy, tool-fs and FSLocal, waiting whenIdle and flush in both arms',
      latencyBoundary: 'read/write timings include a completed native tool turn and its durable history; they are not standalone filesystem syscall timings',
      durability: 'FSLocal file.sync + atomic rename in both arms, with no extra fsync or benchmark endpoint; directory fsync absent',
      history: 'candidate bounded 128 KiB retained page; checksum validates the entire containing Zstd frame, so giant-frame CPU/I/O can exceed page budget',
      resources: 'equal fixture process/UID/disk and services; RSS/CPU/I/O/event-loop data are aggregate for the process and cannot be attributed to an individual Context' },
    hardware: { platform: platform(), release: release(), cpus: cpus().map(cpu => ({ model: cpu.model, speed: cpu.speed })),
      totalMemory: totalmem(), constrainedMemory: process.constrainedMemory(),
      filesystemType: String(filesystem.type), blockSize: String(filesystem.bsize) },
    limits: { runtimeRequestMs: 5000, cancellationMs: 5000, requestBytes: 1024 * 1024, responseBytes: 16 * 1024 * 1024,
      userTasksInParallel: 2, samplesEachArmPerUser: 100, warmupsEachArmPerUser: 5, maximumP95Ratio: 1.10, listOpenCandidateP95Ms: 500 },
    report, raw, phases, witnesses, quiescence, resources: { memoryBefore, memoryAfter: finishMemory,
      cpu: finishCpu, io: { before: ioBefore, after: finishIo } },
    containsCredentials: false, blocked: blockers.length > 0, blockers,
    preservedMicrobenchmark: 'AUTH-005/v1 remains NON-EQUIVALENT and is not used as acceptance evidence',
  }
  await writeFile(join(output, 'samples-and-report.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  process.stdout.write(JSON.stringify({ version: result.version, report, blockers, output }) + '\n')
  process.exitCode = blockers.length === 0 ? 0 : 2
} finally {
  delay.disable()
  await baseline?.close()
  await h?.close(false)
  await candidate?.close()
  await rm(root, { recursive: true, force: true })
}

function present<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('required native fixture value missing')
  return value
}
