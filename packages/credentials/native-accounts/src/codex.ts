/** Managed connection to the pinned official Codex app-server; never starts a model turn. */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { JsonRpcLineTransport } from '@arx-ai/arx-sdk-protocol'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'

/** Inputs shared by native account probes and model transports. */
export interface CodexConnectionSpec {
  cwd: string
  env: NodeJS.ProcessEnv
  graceMs: number
  signal: AbortSignal
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  onRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>
}
/** Initialized protocol connection whose close waits for the complete process tree. */
export interface CodexConnection {
  request(method: string, params: object, signal?: AbortSignal): Promise<unknown>
  onNotification(handler: (method: string, params: Record<string, unknown>) => void): void
  readonly closed: Promise<void>
  close(): Promise<void>
}
/** Resolve the same official wrapper used by the native Codex subagent.
 * @returns Node, the pinned wrapper, and the stdio app-server arguments.
 */
export function codexAppServerArgv(): string[] {
  const manifestPath = createRequire(import.meta.url).resolve('@openai/codex/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin: { codex: string } }
  return [process.execPath, resolve(dirname(manifestPath), manifest.bin.codex), 'app-server', '--stdio']
}
/** Start and initialize a managed app-server without starting a thread or reading credentials.
 * @param spec - command environment and owning subprocess service.
 * @returns an initialized connection; its owner must close it.
 */
export async function openCodexConnection(spec: CodexConnectionSpec): Promise<CodexConnection> {
  spec.signal.throwIfAborted()
  const child = spec.spawn({ argv: codexAppServerArgv(), cwd: spec.cwd, env: spec.env,
    graceMs: spec.graceMs, signal: spec.signal,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 0 } } })
  const wire = new JsonRpcLineTransport(child.stdout!, child.stdin!)
  const outcome = child.done.then(() => { wire.close() }, () => { wire.close() })
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => closing ??= (async () => {
    wire.close()
    child.terminate()
    await outcome
    await child.waitForExit()
  })()
  wire.onRequest(spec.onRequest ?? (() => Promise.reject(new Error('Native account probe does not accept product requests'))))
  wire.start()
  try {
    await wire.request('initialize', { clientInfo: { name: 'arx-harness', version: '1.0.10' },
      capabilities: { experimentalApi: true } }, spec.signal)
    wire.notify('initialized', {})
    return { request: (method, params, signal = spec.signal) => wire.request(method, params, signal),
      onNotification: handler => { wire.onNotification(handler) }, closed: outcome, close }
  } catch (error) {
    await close()
    throw error
  }
}
