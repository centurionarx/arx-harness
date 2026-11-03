/**
 * AUTH-005 versioned keyless fixture runner. Run only during the agreed idle
 * window; raw samples and non-equivalences are retained even when gates fail.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, mkdir, rm, statfs, readFile } from 'node:fs/promises'
import { tmpdir, cpus, totalmem, platform, release } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { SessionId, SESSION_FORMAT_VERSION } from '@arx-ai/arx-session'
import type { SessionEvent, SessionHeader } from '@arx-ai/arx-session'
import { MessageId, freezeMessage } from '@arx-ai/arx-llm'
import { ModuleId } from '@arx-ai/arx-web-identity'
import type { OwnerScope, RequestAuthority } from '@arx-ai/arx-web-identity'
import type { WorkspaceId } from '@arx-ai/arx-workspace/types'
import { eventLines, toHeaderLine } from '../../packages/session/session-persistence-jsonl/src/format.ts'
import { storageHarness } from '../../packages/identity/project-storage/tests/harness.ts'

const WORKLOAD = Object.freeze({ users: 2, sessionsPerUser: 1000, largeLogBytes: 10 * 1024 * 1024,
  smallLogMaxBytes: 1024, filesPerUser: 10000, fileBytes: 1024, pageHeaders: 50,
  historyPageBytes: 128 * 1024, appendBytes: 1024, warmups: 5, samplesPerUserPerArm: 100 })
const compression = process.argv[3] ?? 'zstd'
if (compression !== 'none' && compression !== 'zstd') throw new Error('explicit none or zstd benchmark encoding required')
const output = resolve(process.argv[2] ?? '')
if (process.argv[2] === undefined) throw new Error('explicit fixture evidence output directory required')
const scenarioRoot = await mkdtemp(join(tmpdir(), 'arx-auth005-bench-'))
const raw: { arm: string
  operation: string
  user: number
  iteration: number
  milliseconds: number }[] = []
const checkpoints: unknown[] = []
const delayer = monitorEventLoopDelay({ resolution: 10 })
let worker: ReturnType<typeof spawn> | undefined
let harness: Awaited<ReturnType<typeof storageHarness>> | undefined
function events(text: string, start = 0, turn = 1): SessionEvent[] {
  return [
    { type: 'turn/start', seq: start, time: 1, data: { turn } },
    { type: 'user/message', seq: start + 1, time: 2,
      data: freezeMessage({ id: MessageId('bench-' + String(turn)), role: 'user', content: [{ type: 'text',
        text }], source: { kind: 'user' } }), surfaceOp: 'append' },
    { type: 'turn/end', seq: start + 2, time: 3, data: { turn, reason: { kind: 'completed' } } },
  ]
}
function pseudoText(bytes: number): string {
  const output = Buffer.allocUnsafe(bytes)
  let state = 0x7621f13d
  for (let i = 0; i < bytes; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; output[i] = 65 + (state >>> 0) % 26 }
  return output.toString('ascii')
}
function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0
}
async function time(arm: string, operation: string, user: number, iteration: number, call: () => Promise<unknown>) {
  const start = performance.now(); await call()
  if (iteration >= WORKLOAD.warmups) raw.push({ arm, operation, user, iteration: iteration - WORKLOAD.warmups,
    milliseconds: performance.now() - start })
}
type UserData = { authority: RequestAuthority
  scope: OwnerScope
  projectId: string
  workspaceId: WorkspaceId
  volume: string
  sessions: SessionHeader[]
  nextSeq: number
  turn: number }
const users: UserData[] = []
try {
  await mkdir(output, { recursive: true, mode: 0o700 })
  harness = await storageHarness({ root: scenarioRoot, initialize: true, readyUsers: 2, compression })
  for (let user = 0; user < WORKLOAD.users; user++) {
    const authority = present(harness.users[user]).authority
    const project = await harness.ctx.projectStorage.createProject(authority, 'Benchmark ' + String(user))
    const workspace = await harness.ctx.projectStorage.createWorkspace(authority, project.projectId, 'Benchmark ' + String(user))
    const provision = await harness.ctx.projectStorage.provision(authority, workspace.workspaceId)
    users.push({ authority, scope: provision.scope, projectId: project.projectId, workspaceId: workspace.workspaceId,
      volume: provision.volumePath, sessions: [], nextSeq: 3, turn: 2 })
  }
  const giant = pseudoText(WORKLOAD.largeLogBytes)
  await Promise.all(users.map(async (user) => {
    for (let session = 0; session < WORKLOAD.sessionsPerUser; session++) {
      const meta = await present(harness).ctx.projectStorage.register(user.authority, user.workspaceId,
        { id: SessionId(randomUUID()), version: SESSION_FORMAT_VERSION, createdAt: session })
      const body = session === 0
        ? giant.slice(0, WORKLOAD.largeLogBytes - Buffer.byteLength(JSON.stringify(toHeaderLine(meta))) - 1 - Buffer.byteLength(eventLines(events(''), true)) - 1) : 'small'
      await present(harness).ctx.projectStorage.append(user.authority, meta.id, events(body))
      if (session === 0
        && Buffer.byteLength(present((await present(harness).ctx.sessionPersistence.readRaw(meta.id))).content)
        !== WORKLOAD.largeLogBytes) {
        throw new Error('large-log workload is not exactly 10 MiB')
      }
      if (session !== 0) {
        const artifact = await present(harness).ctx.sessionPersistence.readRaw(meta.id)
        if (artifact === undefined
          || Buffer.byteLength(artifact.content) > WORKLOAD.smallLogMaxBytes) throw new Error('small-log workload exceeds 1 KiB')
      }
      user.sessions.push(meta)
    }
    for (let file = 0; file < WORKLOAD.filesPerUser; file++) await writeFile(join(user.volume,
      'file-' + String(file) + '.txt'), 'x'.repeat(WORKLOAD.fileBytes), { mode: 0o600 })
  }))
  const workerPath = fileURLToPath(new URL('./benchmark-worker.ts', import.meta.url))
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL)/i.test(key)))
  worker = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', workerPath,
    JSON.stringify(users.map(user => ({ userId: user.scope.userId, volume: user.volume })))],
  { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  let workerLine = ''
  const endpoint = await new Promise<string>((resolveEndpoint, reject) => {
    present(present(worker).stdout).on('data', (chunk) => {
      workerLine += String(chunk)
      const newline = workerLine.indexOf('\n')
      if (newline >= 0) {
        try {
          const info = JSON.parse(workerLine.slice(0, newline)) as { url?: unknown }
          if (typeof info.url !== 'string') throw new Error('fixture worker')
          resolveEndpoint(info.url)
        }
        catch (error) { reject(error instanceof Error ? error : new Error('fixture endpoint parsing failed')) }
      }
    })
    present(worker).once('error', reject)
    present(worker).once('exit', (code) => { if (!workerLine.includes('\n')) reject(new Error('fixture worker exited ' + String(code))) })
  })
  delayer.enable()
  const cpuBefore = process.cpuUsage()
  const rssBefore = process.memoryUsage()
  const workerStates: unknown[] = []
  for (const operation of ['list', 'open', 'append', 'read-file', 'write-file']) {
    const phaseStart = performance.now()
    const phaseCpu = process.cpuUsage()
    await Promise.all(users.map(async (user, userIndex) => {
      for (let iteration = 0; iteration < WORKLOAD.warmups + WORKLOAD.samplesPerUserPerArm; iteration++) {
        const order = iteration % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']
        for (const arm of order) await time(arm, operation, userIndex, iteration, async () => {
          const persistence = present(harness).ctx.sessionPersistence
          if (operation === 'list') {
            if (arm === 'baseline') {
              const all = await persistence.list()
              const own = all.filter(value => value.cwd === user.volume).sort((a,
                b) => String(a.id).localeCompare(String(b.id))).slice(0, WORKLOAD.pageHeaders)
              if (own.length !== WORKLOAD.pageHeaders) throw new Error('baseline metadata workload missing')
            } else {
              const page = await present(harness).ctx.projectStorage.list(user.authority, { kind: 'workspace',
                workspaceId: user.workspaceId })
              if (page.sessions.length !== WORKLOAD.pageHeaders) throw new Error('candidate metadata workload missing')
            }
          } else if (operation === 'open') {
            if (arm === 'baseline') {
              const artifact = await persistence.readRaw(present(user.sessions[0]).id)
              if (artifact === undefined || Buffer.byteLength(artifact.content.slice(0,
                WORKLOAD.historyPageBytes)) < WORKLOAD.historyPageBytes) throw new Error('baseline large-log workload missing')
            } else {
              const page = await present(harness).ctx.projectStorage.read(user.authority, present(user.sessions[0]).id)
              if (Buffer.byteLength(JSON.stringify(page)) > WORKLOAD.historyPageBytes
                || page.nextCursor === undefined) throw new Error('candidate page contract')
            }
          } else if (operation === 'append') {
            const turn = user.turn++
            const payloadBytes = WORKLOAD.appendBytes - Buffer.byteLength(eventLines(events('', user.nextSeq, turn), true)) - 1
            const batch = events('x'.repeat(payloadBytes), user.nextSeq, turn)
            if (Buffer.byteLength(eventLines(batch, true)) + 1 !== WORKLOAD.appendBytes) throw new Error('append workload size')
            user.nextSeq += batch.length
            if (arm === 'baseline') await persistence.append(present(user.sessions[1]).id, batch)
            else await present(harness).ctx.projectStorage.append(user.authority, present(user.sessions[1]).id, batch)
          } else {
            if (arm === 'candidate') {
              await present(harness).ctx.webIdentity.authorizeOwner(user.authority, { kind: 'workspace',
                workspaceId: user.workspaceId }, ModuleId('runtime'))
              await present(harness).ctx.webIdentity.revalidate(user.authority)
            }
            const response = await fetch(endpoint + '/_arx/benchmark/' + (operation === 'read-file' ? 'read' : 'write') + '?file=' + String(iteration),
              { method: 'POST', headers: { Authorization: 'Bearer disposable-benchmark-worker', 'x-arx-user-id': user.scope.userId,
                'x-arx-benchmark-mode': arm, 'x-arx-authority-revision': String(user.authority.revision),
                'x-arx-workspace-id': user.workspaceId } })
            if (!response.ok) throw new Error('fixture FS worker operation failed')
            const result = await response.json() as { userId?: unknown; bytes?: unknown; memory?: unknown; cpu?: unknown }
            if (result.userId !== user.scope.userId || result.bytes !== 1024) throw new Error('fixture FS receipt')
            workerStates.push({ operation, arm, memory: result.memory, cpu: result.cpu })
            if (arm === 'candidate') await present(harness).ctx.webIdentity.revalidate(user.authority)
          }
        })
      }
    }))
    const phaseMilliseconds = performance.now() - phaseStart
    const phaseOperations = WORKLOAD.users * (WORKLOAD.warmups + WORKLOAD.samplesPerUserPerArm) * 2
    checkpoints.push({ operation, milliseconds: phaseMilliseconds, operationsIncludingWarmups: phaseOperations,
      throughputOperationsPerSecondIncludingWarmups: phaseOperations / (phaseMilliseconds / 1000),
      memory: process.memoryUsage(), cpu: process.cpuUsage(phaseCpu) })
  }
  delayer.disable()
  const report = ['list', 'open', 'append', 'read-file', 'write-file'].map((operation) => {
    const baseline = raw.filter(value => value.operation === operation && value.arm === 'baseline').map(value => value.milliseconds)
    const candidate = raw.filter(value => value.operation === operation && value.arm === 'candidate').map(value => value.milliseconds)
    const baselineP95 = percentile(baseline, 0.95), candidateP95 = percentile(candidate, 0.95)
    const ratio = candidateP95 / baselineP95
    const comparable = !operation.endsWith('-file')
    const localBoundPassed = !['list','open'].includes(operation) || candidateP95 <= 500
    return { operation, comparable, samplesEach: baseline.length,
      baseline: { p50: percentile(baseline, 0.5), p95: baselineP95 },
      candidate: { p50: percentile(candidate, 0.5), p95: candidateP95 },
      ratio, regressionPassed: comparable ? ratio <= 1.10 : null, localBoundPassed,
      status: !comparable ? 'BLOCKED_NON_EQUIVALENT_FIXTURE_MICROBENCHMARK' : ratio > 1.10 || !localBoundPassed ? 'FAIL' : 'PASS' }
  })
  const source = await readFile(new URL('../../packages/session/session-persistence-jsonl/src/index.ts', import.meta.url), 'utf8')
  const filesystem = await statfs(scenarioRoot, { bigint: true })
  const shutdownStart = performance.now()
  const workerClosed = once(worker, 'close')
  worker.kill('SIGTERM')
  await workerClosed
  const quiescence = { milliseconds: performance.now() - shutdownStart,
    exited: worker.exitCode !== null || worker.signalCode !== null, exitCode: worker.exitCode, signalCode: worker.signalCode,
    limitation: 'disposable child supervisor exit only; production process-tree and UID isolation not proven' }
  if (!quiescence.exited) throw new Error('fixture worker shutdown was not confirmed')
  const result = {
    version: 'AUTH-005/v1', baselineVersion: '1.0.40', baselineCommit: '1e5309f133c8a09599fc90cfc003a1556677895b',
    sourceSha256: createHash('sha256').update(source).digest('hex'), workload: WORKLOAD,
    hardware: { platform: platform(), release: release(), cpus: cpus().map(cpu => cpu.model), totalMemory: totalmem(),
      filesystemType: String(filesystem.type), blockSize: String(filesystem.bsize), processLimits: process.constrainedMemory() },
    equivalence: { compression, storage: 'same provider, private files and physical disk; alternating arms; two USER tasks parallel',
      append: 'both fsync existing JSONL; candidate also commits derived SQLite FULL metadata',
      filesystem: 'same real FSLocal worker and HTTP transport; both add directory fsync after atomic rename',
      operationalLimits: 'same fixture process/UID; no real worker topology, CPU/RAM quota, mounts or network-isolation proof' },
    report, raw, checkpoints, workerStates, quiescence, resources: { before: rssBefore,
      after: process.memoryUsage(), cpu: process.cpuUsage(cpuBefore),
      eventLoop: { p50Ms: delayer.percentile(50) / 1e6, p95Ms: delayer.percentile(95) / 1e6, maxMs: delayer.max / 1e6 } },
    blocked: true, blockers: ['FS read/write are fixture microbenchmarks and not equivalent to the unauthorized production tool/worker topology',
      ...report.filter(row => row.comparable && row.status !== 'PASS').map(row => row.operation + ' exceeds an approved performance gate')],
    containsCredentials: false,
  }
  await writeFile(join(output, 'samples-and-report.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  process.stdout.write(JSON.stringify({ version: result.version, report, blockers: result.blockers, output }) + '\n')
  process.exitCode = result.blockers.length === 0 ? 0 : 2
} finally {
  delayer.disable()
  if (worker !== undefined && worker.exitCode === null
    && worker.signalCode === null) { worker.kill('SIGTERM'); await once(worker, 'close') }
  await harness?.close(false)
  await rm(scenarioRoot, { recursive: true, force: true })
}

function present<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('required native fixture value missing')
  return value
}
