/**
 * Source-mode bundling: a bundled module keeps each source file's
 * `import.meta.url`, and any other `import.meta` use fails the bundle.
 */

import { once } from 'node:events'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { bundleWorkerSource } from '../src/entry.ts'

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/entry/${name}`, import.meta.url))
}

it('pins import.meta.url to the source file of the module that reads it', async () => {
  const worker = new Worker(await bundleWorkerSource(fixture('reports-url.ts')), { env: {}, execArgv: [] })
  const messages: unknown[] = []
  worker.on('message', (message) => { messages.push(message) })
  // The fixture exits on its own after posting, so the test never terminates
  // a just-loaded worker.
  const [code] = await once(worker, 'exit') as [number]
  expect(code).toBe(0)
  expect(messages).toEqual([pathToFileURL(fixture('url.ts')).href])
})

it('rejects a module that reads import.meta beyond url', async () => {
  await expect(bundleWorkerSource(fixture('reads-dirname.ts'))).rejects.toThrow(/"import\.meta" is not available/)
})
