/**
 * Vitest global setup that seeds the HTTP browser fixture's identity once per
 * Vitest process. A child process starts the seed in the background when
 * the run starts, so no test hook waits for its password hashing unless a
 * fixture asks before it ends. A loopback server answers each fixture start
 * with the seed root and credentials; it requires the per-run bearer token
 * that `provide` hands to the workers. Teardown stops an unfinished seed and
 * removes the root.
 */
import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'
import type { IdentitySeedAddress } from './browser-fixture.contract.ts'

declare module 'vitest' {
  interface ProvidedContext {
    /** The seed address `identity-seed.global.ts` provides to the workers of its project. */
    identitySeed: IdentitySeedAddress
  }
}

/**
 * Start the background seed and the loopback server that hands it out.
 * @param project - the Vitest project whose workers receive the seed address.
 * @returns teardown that stops the seed and removes its root.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arx-auth-seed-')))
  const child = fork(fileURLToPath(new URL('./identity-seed.host.ts', import.meta.url)), [root],
    { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-4096) })
  const seed = new Promise<string>((resolve, reject) => {
    child.once('message', (message: unknown) => { resolve(JSON.stringify(message)) })
    child.once('exit', (code, signal) => { reject(new Error(`identity seed exited (${String(code ?? signal)}): ${stderr}`)) })
  })
  // A seed failure reaches the fixture that asks for it; a run without HTTP fixtures never asks.
  seed.catch(() => { })
  const token = randomBytes(24).toString('hex')
  const server = createServer((request, response) => {
    if (request.headers.authorization !== 'Bearer ' + token) {
      response.writeHead(403).end()
      return
    }
    seed.then((body) => { response.writeHead(200, { 'Content-Type': 'application/json' }).end(body) },
      (error: unknown) => { response.writeHead(503).end(error instanceof Error ? error.message : 'identity seed failed') })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  project.provide('identitySeed', { url: 'http://127.0.0.1:' + String((server.address() as AddressInfo).port), token })
  return async () => {
    server.close()
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    await rm(root, { recursive: true, force: true })
  }
}
