import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { setImmediate } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { GitSkillService } from '../src/index.ts'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}))

const children: EventEmitter[] = []
const services: GitSkillService[] = []
const roots: string[] = []
afterEach(async () => {
  for (const child of children.splice(0)) child.emit('close', null)
  await Promise.allSettled(services.splice(0).map(service => service.dispose()))
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.resetAllMocks()
})

async function pendingClone() {
  const root = await mkdtemp(join(tmpdir(), 'arx-skill-child-')); roots.push(root)
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true),
  })
  children.push(child)
  vi.mocked(spawn).mockImplementationOnce((_file, _args, options) => {
    const aborted = () => { child.emit('error', new Error('child aborted')) }
    options?.signal?.addEventListener('abort', aborted, { once: true })
    child.once('close', () => { options?.signal?.removeEventListener('abort', aborted) })
    return child as unknown as ReturnType<typeof spawn>
  })
  const service = new GitSkillService({ cacheDir: join(root, 'cache') }); services.push(service)
  let settled = false
  const result = service.snapshot({ repository: join(root, 'repository'), commit: 'a'.repeat(40), paths: ['SKILL.md'] })
    .then(value => ({ value }), (error: unknown) => ({ error }))
    .finally(() => { settled = true })
  await vi.waitFor(() => { expect(spawn).toHaveBeenCalledOnce() })
  return { child, service, result, settled: () => settled }
}

it('waits for close after output overflow and preserves that failure through a later child error', async () => {
  const operation = await pendingClone()
  operation.child.stdout.write(Buffer.alloc(8 * 1024 * 1024 + 1))
  operation.child.emit('error', new Error('termination failed'))
  operation.child.stdout.write(Buffer.from('late output'))
  await setImmediate()
  expect(operation.child.kill).toHaveBeenCalledOnce()
  expect(operation.settled()).toBe(false)
  operation.child.emit('close', null)
  expect(await operation.result).toHaveProperty('error.message', 'skill-git command output exceeds configured limit')
})

it('keeps disposal pending after child error until its streams close', async () => {
  const operation = await pendingClone()
  let disposed = false
  const disposal = operation.service.dispose().then(() => { disposed = true })
  await setImmediate()
  expect(operation.settled()).toBe(false)
  expect(disposed).toBe(false)
  operation.child.emit('close', null)
  expect(await operation.result).toHaveProperty('error.message', 'skill-git repository operation failed')
  await disposal
  expect(disposed).toBe(true)
})
