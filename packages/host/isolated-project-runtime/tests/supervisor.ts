/** Disposable HTTP supervisor exercises receipts and child-process quiescence. */
import { createServer, type IncomingMessage } from 'node:http'
import type { ServerResponse } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { ClientRequest } from '@arx-ai/arx-host-apiproxy/api'

export interface SupervisorOperation {
  readonly id: string
  readonly userId: string
  readonly revision: string
  readonly capability: string
  readonly child?: ChildProcess
  readonly response: ServerResponse
  readonly workspaceId?: string
}
export async function supervisorFixture() {
  const operations = new Map<string, SupervisorOperation>()
  const accepted: ClientRequest[] = []
  // Arrival order of every non-cancel request: path and workspace header.
  const log: string[] = []
  const cancelled: string[] = []
  const workspaceFrames = new Map<string, unknown[]>()
  const workspaceResults = new Map<string, unknown>()
  const failingWorkspaces = new Set<string>()
  const refusingWorkspaces = new Set<string>()
  let hold = false
  let corruptEcho = false
  let invalidQuiescence = false
  let result: unknown
  let frame: unknown
  let wireReply: { body: string
    status: number
    headers: Record<string, string> } | undefined
  let cancelStatus = 200
  let onAccepted: (() => void) | undefined
  let onCancelled: (() => void) | undefined
  let cancellationBarrier: Promise<void> | undefined
  async function handleFixtureRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const operationId = String(request.headers['x-arx-operation-id'])
    if (request.headers.authorization !== 'Bearer disposable-supervisor-fixture') { response.writeHead(401); response.end(); return }
    if (request.url === '/_arx/operations/' + operationId + '/cancel') {
      const operation = operations.get(operationId)
      if (operation?.child !== undefined && operation.child.exitCode === null) {
        operation.child.kill('SIGTERM')
        await once(operation.child, 'close')
      }
      operation?.response.end()
      operations.delete(operationId)
      cancelled.push(operationId)
      onCancelled?.()
      await cancellationBarrier
      response.writeHead(cancelStatus, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ operationId, quiescent: !invalidQuiescence }))
      return
    }
    const buffers: Buffer[] = []
    for await (const chunk of request) buffers.push(Buffer.from(chunk as Uint8Array))
    const workspaceHeader = request.headers['x-arx-workspace-id']
    const workspaceId = typeof workspaceHeader === 'string' ? workspaceHeader : undefined
    log.push(String(request.url) + ' ' + (workspaceId ?? '-'))
    if (workspaceId !== undefined && failingWorkspaces.has(workspaceId)) {
      response.writeHead(500, { 'x-arx-operation-id': operationId }); response.end(); return
    }
    if (wireReply !== undefined && !hold) {
      response.writeHead(wireReply.status, { 'content-type': 'application/json', 'x-arx-operation-id': operationId,
        'x-arx-quiescent': 'true', ...wireReply.headers })
      response.end(wireReply.body); return
    }
    if (request.url?.startsWith('/api/events.')) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'x-arx-operation-id': operationId })
      operations.set(operationId, { id: operationId, userId: String(request.headers['x-arx-user-id']),
        revision: String(request.headers['x-arx-authority-revision']),
        capability: String(request.headers['x-arx-worker-capability']), response,
        ...(workspaceId === undefined ? {} : { workspaceId }) })
      const frames = workspaceId === undefined ? undefined : workspaceFrames.get(workspaceId)
      for (const value of frames ?? (frame === undefined ? [] : [frame])) response.write('data: ' + JSON.stringify(value) + '\n\n')
      response.flushHeaders()
      onAccepted?.()
      return
    }
    if (request.url?.startsWith('/api/session.export')) {
      response.writeHead(200, { 'content-type': 'application/zip', 'x-arx-operation-id': operationId,
        'x-arx-quiescent': 'true', 'x-arx-export-sessions': JSON.stringify(result) })
      response.end('fixture-zip')
      return
    }
    const envelope = JSON.parse(Buffer.concat(buffers).toString()) as ClientRequest
    accepted.push(envelope)
    const child = hold ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env: {}, stdio: 'ignore' }) : undefined
    if (child !== undefined) await once(child, 'spawn')
    operations.set(operationId, { id: operationId, userId: String(request.headers['x-arx-user-id']),
      revision: String(request.headers['x-arx-authority-revision']),
      capability: String(request.headers['x-arx-worker-capability']), ...(child === undefined ? {} : { child }), response,
      ...(workspaceId === undefined ? {} : { workspaceId }) })
    response.setHeader('content-type', 'application/json')
    response.setHeader('x-arx-operation-id', corruptEcho ? 'wrong-operation' : operationId)
    response.setHeader('x-arx-quiescent', child === undefined ? 'true' : 'false')
    response.flushHeaders()
    onAccepted?.()
    if (hold) return
    operations.delete(operationId)
    const scopedResult = workspaceId === undefined ? undefined : workspaceResults.get(workspaceId)
    const value = scopedResult !== undefined ? scopedResult : result === undefined
      ? envelope.method === 'session.create' ? { sessionId: (envelope.payload as { sessionId: string }).sessionId } : {} : result
    response.end(JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId,
      result: workspaceId !== undefined && refusingWorkspaces.has(workspaceId)
        ? { ok: false, error: { code: 'internal', message: 'fixture refusal', details: {} } } : { ok: true, value } }))
  }
  const server = createServer((request, response) => { void handleFixtureRequest(request, response) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture listener unavailable')
  return {
    endpoint: 'http://127.0.0.1:' + String(address.port), operations, accepted, log, cancelled,
    /** Frames written on every event stream opened for one workspace, replacing the shared frame. */
    framesFor(workspaceId: string, values: unknown[]) { workspaceFrames.set(workspaceId, values) },
    /** Unary result returned for one workspace, replacing the shared result. */
    resultFor(workspaceId: string, value: unknown) { workspaceResults.set(workspaceId, value) },
    /** Every later request for one workspace receives HTTP 500. */
    failFor(workspaceId: string) { failingWorkspaces.add(workspaceId) },
    /** Every later unary request for one workspace receives a canonical business error. */
    refuseFor(workspaceId: string) { refusingWorkspaces.add(workspaceId) },
    hold(value: boolean) { hold = value },
    corruptEcho(value: boolean) { corruptEcho = value },
    invalidQuiescence(value: boolean) { invalidQuiescence = value },
    result(value: unknown) { result = value },
    frame(value: unknown) { frame = value },
    rawReply(body: string, headers: Record<string, string> = {}, status = 200) { wireReply = { body, headers, status } },
    resetReply() { wireReply = undefined },
    cancelStatus(value: number) { cancelStatus = value },
    acceptedSignal() { return new Promise<void>((resolve) => { onAccepted = resolve }) },
    cancelledSignal() { return new Promise<void>((resolve) => { onCancelled = resolve }) },
    cancellationGate(barrier?: Promise<void>) { cancellationBarrier = barrier },
    async close() {
      for (const operation of operations.values()) {
        if (operation.child !== undefined
          && operation.child.exitCode === null) { operation.child.kill('SIGTERM'); await once(operation.child, 'close') }
        operation.response.end()
      }
      operations.clear()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => { if (error !== undefined) reject(error); else resolve() }))
    },
  }
}
