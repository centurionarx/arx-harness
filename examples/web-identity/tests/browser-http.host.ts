/** Same-origin HTTP probes run in Chromium's actual cookie context; no cookie copying or auth adapter. */
import assert from 'node:assert/strict'
import type { BrowserContext } from 'playwright'

/** Response projection for assertions only; bodies never enter receipts or tracing. */
export interface BrowserHttpResponse {
  status(): number
  headers(): Record<string, string>
  text(): Promise<string>
  json(): Promise<unknown>
  body(): Promise<Buffer>
}

/**
 * Exercise the actual browser fetch carrier on one fixture origin.
 * @param ctx - Independent browser principal context.
 * @param url - Actual disposable server URL.
 * @param options - Method, ephemeral headers and canonical JSON body.
 * @returns Private response projection consumed by assertions.
 */
export async function browserHttp(ctx: BrowserContext, url: string,
  options: { method?: 'GET' | 'POST'; headers?: Record<string, string>; data?: unknown } = {}): Promise<BrowserHttpResponse> {
  const target = new URL(url)
  let current = ctx.pages().find((page) => {
    try { return new URL(page.url()).origin === target.origin } catch { return false }
  })
  const created = current === undefined
  if (current === undefined) {
    current = await ctx.newPage()
    await current.goto(target.origin + '/', { waitUntil: 'domcontentloaded' })
  }
  try {
    assert.equal(await current.evaluate(() => location.origin), target.origin)
    const response = await current.evaluate(async ({ url, method, headers, data }) => {
      const response = await fetch(url, {
        method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json', ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      })
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), text: await response.text() }
    }, { url: target.href, method: options.method ?? 'GET', headers: options.headers ?? {}, data: options.data })
    return {
      status: () => response.status,
      headers: () => response.headers,
      text: () => Promise.resolve(response.text),
      json: () => Promise.resolve(JSON.parse(response.text) as unknown),
      body: () => Promise.resolve(Buffer.from(response.text, 'utf8')),
    }
  } finally { if (created) await current.close() }
}
