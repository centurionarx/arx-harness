/**
 * Disposable FSLocal microbenchmark worker. This endpoint is fixture-only:
 * it is neither a product API nor evidence of UID/mount/network isolation.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { open } from 'node:fs/promises'
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import FsLocal from '@arx-ai/arx-fs-local'

const parsedRoots: unknown = JSON.parse(process.argv[2] ?? 'null')
if (!Array.isArray(parsedRoots) || parsedRoots.length !== 2) throw new Error('explicit disposable worker roots required')
const roots: { userId: string; volume: string }[] = []
for (const value of parsedRoots as unknown[]) {
  if (typeof value !== 'object' || value === null) throw new Error('explicit disposable worker roots required')
  const row = value as Record<string, unknown>
  if (typeof row.userId !== 'string' || typeof row.volume !== 'string') throw new Error('explicit disposable worker roots required')
  roots.push({ userId: row.userId, volume: row.volume })
}
const contexts: Context[] = []
for (const row of roots) {
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.internal = { version: 'v2', async import(name: string) {
    if (name !== '@arx-ai/arx-fs-local') throw new Error('worker plugin not allowed')
    return FsLocal
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: '@arx-ai/arx-fs-local', config: { cwd: row.volume } })
  await ctx.loader.await()
  contexts.push(ctx)
}
async function handleFixtureRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    if (request.headers.authorization !== 'Bearer disposable-benchmark-worker') throw new Error('fixture credential')
    const row = roots.findIndex(value => value.userId === request.headers['x-arx-user-id'])
    if (row < 0) throw new Error('fixture owner')
    if (request.headers['x-arx-benchmark-mode'] === 'candidate'
      && (!/^[0-9]+$/.test(String(request.headers['x-arx-authority-revision'])) || typeof request.headers['x-arx-workspace-id'] !== 'string')) {
      throw new Error('fixture authority metadata')
    }
    const url = new URL(request.url ?? '/', 'http://benchmark.invalid')
    if (!['/_arx/benchmark/read', '/_arx/benchmark/write'].includes(url.pathname)) throw new Error('fixture operation')
    const index = Number(url.searchParams.get('file'))
    if (!Number.isSafeInteger(index) || index < 0 || index >= 10000) throw new Error('fixture file index')
    const ctx = contexts[row], owner = roots[row]
    if (ctx === undefined || owner === undefined) throw new Error('fixture owner composition missing')
    const target = await ctx.fs.resolve('file-' + String(index) + '.txt')
    if (url.pathname.endsWith('/read')) {
      const data = await ctx.fs.readBytes(target, undefined, 1024)
      if (data.length !== 1024) throw new Error('fixture read size')
    } else {
      await ctx.fs.writeText(target, 'x'.repeat(1024))
      // V1 adds this same fixture-only directory sync to both arms and remains
      // non-equivalent to native tool/worker execution; V2 does not use it.
      const directory = await open(owner.volume, 'r')
      try { await directory.sync() } finally { await directory.close() }
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ ok: true, userId: owner.userId, bytes: 1024,
      memory: process.memoryUsage(), cpu: process.cpuUsage() }))
  } catch {
    response.writeHead(400); response.end('fixture request denied')
  }
}
const server = createServer((request, response) => { void handleFixtureRequest(request, response) })
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (address === null || typeof address === 'string') throw new Error('fixture worker address')
process.stdout.write(JSON.stringify({ url: 'http://127.0.0.1:' + String(address.port), pid: process.pid }) + '\n')
async function close() {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
  for (const ctx of contexts) await ctx.fiber.dispose()
  process.exit(0)
}
process.once('SIGTERM', () => { void close() })
