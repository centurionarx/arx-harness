/** Private IPC fixture control; it never prints or serializes credentials. */
import { fork, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import type { BrowserFixtureControl } from './browser-fixture.contract.ts'
export async function browserFixture(audience: 'user' | 'admin', firstPassword = false, frontend = false, projectRuntime = false): Promise<BrowserFixtureControl & { readonly child: ChildProcess }> {
  const child = fork(fileURLToPath(new URL('./browser-server.host.ts', import.meta.url)),
    [audience, ...(firstPassword ? ['--first-password'] : []), ...(frontend ? ['--frontend'] : []), ...(projectRuntime ? ['--runtime'] : [])],
    { execArgv: ['--import', 'tsx'], silent: true })
  const ready = await message(child, 'ready') as unknown as Omit<BrowserFixtureControl, 'command' | 'close'>
  return { ...ready, child,
    async command(type: string, fields: object = {}): Promise<Record<string, unknown>> {
      const pending = message(child, type === 'block-user' ? 'blocked' : type)
      child.send({ type, ...fields }); return pending
    },
    async close(): Promise<void> {
      if (child.exitCode !== null) return
      const exited = once(child, 'exit'); child.send({ type: 'close' }); await exited
    },
  }
}
function message(child: ChildProcess, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const clear = (): void => { child.off('message', onMessage); child.off('exit', onExit) }
    const onMessage = (raw: unknown): void => {
      if (typeof raw !== 'object' || raw === null) return
      const result = raw as Record<string, unknown>
      if (result.type === type) { clear(); resolve(result) }
      if (result.type === 'fixture-error') { clear(); reject(new Error('identity fixture operation failed')) }
    }
    const onExit = (): void => { clear(); reject(new Error('identity fixture exited before response')) }
    child.on('message', onMessage); child.on('exit', onExit)
  })
}
