/**
 * Private supervisor history carrier. It accepts only opaque runtime capabilities.
 * @module arx-isolated-project-runtime/broker-http
 */
import type { Context } from '@arx-ai/cordis'
import { WORKER_BROKER_PATH, WORKER_CAPABILITY_HEADER } from './broker-contract.ts'
import type {} from './index.ts'
import type {} from '@arx-ai/arx-host-webserver'

/** Stable consumer plugin name. */
export const name = 'worker-history-broker-http'
/** All broker calls use the genuine runtime and host transport services. */
export const inject = ['isolatedProjectRuntime', 'webServer']

/**
 * Mount the closed broker protocol, separate from authenticated browser APIs.
 * @param ctx - Control composition with the runtime lease table and private logs.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: WORKER_BROKER_PATH,
    handler: async (incoming, outgoing) => {
      const controller = new AbortController()
      outgoing.once('close', () =>{  controller.abort() })
      incoming.setTimeout(ctx.isolatedProjectRuntime.config.requestTimeoutMs, () =>{  controller.abort() })
      const chunks: Buffer[] = []
      let length = 0
      try {
        for await (const value of incoming) {
          const chunk: Buffer = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
          length += chunk.byteLength
          if (length > ctx.isolatedProjectRuntime.config.maxRequestBytes) {
            outgoing.writeHead(413); outgoing.end(); return
          }
          chunks.push(chunk)
        }
        const result = await ctx.isolatedProjectRuntime.broker(new Request('http://arx.invalid' + (incoming.url as string), {
          method: incoming.method as string,
          headers: { 'content-type': incoming.headers['content-type'] ?? '',
            [WORKER_CAPABILITY_HEADER]: String(incoming.headers[WORKER_CAPABILITY_HEADER] ?? '') },
          ...(incoming.method === 'GET' || incoming.method === 'HEAD' ? {} : { body: Buffer.concat(chunks, length).toString() }),
          signal: controller.signal,
        }))
        outgoing.writeHead(result.status, Object.fromEntries(result.headers))
        outgoing.end(await result.text())
      } catch {
        if (!outgoing.destroyed) { outgoing.writeHead(503, { 'cache-control': 'no-store' }); outgoing.end() }
      }
    },
  }))
}
