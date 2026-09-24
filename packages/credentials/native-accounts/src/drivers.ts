/** Native product adapters. Only allowlisted account facts leave these process boundaries. */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { access } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { claudeSpawnSpec, ManagedClaudeCodeProcess } from '@arx-ai/arx-claude-agent-sdk-process'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'
import type { NativeAccountDriver } from './manager.ts'
import type { NativeAccountModel, NativeAccountView } from './types.ts'
import { openCodexConnection } from './codex.ts'

/** Resolved deployment inputs shared with native model and subagent processes. */
export interface NativeDriverSpec {
  cwd: string
  env: NodeJS.ProcessEnv
  graceMs: number
  outputMaxBytes: number
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native response')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid native response')
  return value
}
/** Resolve the native platform package shipped with the same pinned Claude Agent SDK.
 * @returns the installed platform executable; no PATH or global installation fallback.
 */
export function claudeAccountExecutable(): string {
  const sdkRequire = createRequire(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk'))
  const report = process.platform === 'linux' ? process.report.getReport() as { header?: { glibcVersionRuntime?: string } } : undefined
  const suffix = process.platform === 'linux' && !report?.header?.glibcVersionRuntime ? '-musl' : ''
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${suffix}`
  return join(dirname(sdkRequire.resolve(`${pkg}/package.json`)), process.platform === 'win32' ? 'claude.exe' : 'claude')
}
async function release(child: SubprocessHandle): Promise<void> {
  child.terminate()
  await child.done.catch(() => { /* Spawn refusal has no running child to await. */ })
  await child.waitForExit()
}
async function claudeStatus(spec: NativeDriverSpec, executable: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  signal.throwIfAborted()
  const child = spec.spawn({ argv: [executable, 'auth', 'status', '--json'], cwd: spec.cwd,
    env: spec.env, signal, graceMs: spec.graceMs,
    stdio: { stdin: 'ignore', stdout: { maxBytes: spec.outputMaxBytes }, stderr: { maxBytes: 0 } } })
  try {
    const result = await child.done
    signal.throwIfAborted()
    if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error('Native status unavailable')
    const output = child.collected.stdout!.readFrom(0)
    if (output.lossy) throw new Error('Native status exceeded its limit')
    return record(JSON.parse(output.text))
  } finally { await release(child) }
}
async function claudeModels(spec: NativeDriverSpec, signal: AbortSignal): Promise<NativeAccountModel[]> {
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) controller.abort()
  const children: SubprocessHandle[] = []
  // An open input with no messages allows initialize/supportedModels without a paid model turn.
  async function* noMessages(): AsyncGenerator<never> {
    if (!controller.signal.aborted) await new Promise<void>(resolve => {
      controller.signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }
  const conversation = query({ prompt: noMessages(), options: {
    cwd: spec.cwd, env: spec.env, abortController: controller, persistSession: false,
    permissionMode: 'dontAsk', tools: [], skills: [],
    spawnClaudeCodeProcess: options => {
      const child = spec.spawn({ ...claudeSpawnSpec(options, spec.graceMs), stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 0 } } })
      children.push(child)
      return new ManagedClaudeCodeProcess(child)
    },
    stderr: () => { /* Account discovery never emits raw product diagnostics. */ },
  } })
  try {
    const models = await conversation.supportedModels()
    return models.map(model => ({ id: model.value, name: model.displayName,
      ...model.resolvedModel === undefined ? {} : { resolvedModel: model.resolvedModel },
      ...model.supportedEffortLevels === undefined ? {} : { efforts: [...model.supportedEffortLevels] } }))
  } finally {
    controller.abort(); conversation.close()
    signal.removeEventListener('abort', abort)
    await Promise.all(children.map(release))
  }
}
/** Native Claude account driver; remote users complete the CLI's own code prompt.
 * @param spec - owning process service and deployment settings.
 * @returns native driver, without starting any process.
 */
export function claudeAccountDriver(spec: NativeDriverSpec): NativeAccountDriver {
  return {
    provider: 'claude-code', label: 'Claude Code', loginModes: ['browser'],
    async describe(signal) {
      let executable: string
      try { executable = claudeAccountExecutable(); await access(executable) }
      catch { return { availability: 'unavailable', status: 'unknown' } }
      const status = await claudeStatus(spec, executable, signal)
      if (status.loggedIn !== true) return { availability: 'available', status: 'disconnected' }
      const authMode = status.authMethod === 'claude.ai' ? 'subscription' : status.authMethod === 'api_key' ? 'api-key' : undefined
      let models: NativeAccountModel[] | undefined
      try { models = await claudeModels(spec, signal) }
      catch { /* Model discovery may fail while the native status remains connected. */ }
      return { availability: 'available', status: 'connected', ...authMode === undefined ? {} : { authMode }, ...models === undefined ? {} : { models } }
    },
    async login(_mode, signal, notice, prompt) {
      signal.throwIfAborted()
      const child = spec.spawn({ argv: [claudeAccountExecutable(), 'auth', 'login', '--claudeai'],
        cwd: spec.cwd, env: spec.env, signal, graceMs: spec.graceMs,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' } })
      let tail = ''
      let prompting = false
      let answer: Promise<void> | undefined
      let parseError: unknown
      const decoder = new StringDecoder('utf8')
      const receive = (chunk: Buffer | string): void => {
        if (parseError !== undefined || signal.aborted) return
        tail = (tail + (typeof chunk === 'string' ? chunk : decoder.write(chunk))).slice(-spec.outputMaxBytes)
        try {
          for (const match of tail.matchAll(/https:\/\/[^\s\x1b]+(?=[\s\x1b])/g)) {
            const url = match[0]
            const host = new URL(url).hostname
            if (['claude.com', 'claude.ai', 'console.anthropic.com', 'platform.claude.com'].includes(host)) notice(url)
          }
          if (!prompting && tail.includes('Paste code here if prompted >')) {
            prompting = true
            answer = prompt().then(code => { if (!signal.aborted) child.stdin!.write(`${code}\n`) })
            void answer.catch(() => { /* Cancellation is awaited through process cleanup below. */ })
          }
        } catch (error) { parseError = error; child.terminate() }
      }
      child.stdout!.on('data', receive); child.stderr!.on('data', receive)
      try {
        const result = await child.done
        signal.throwIfAborted()
        if (parseError !== undefined) throw parseError
        if (result.exitCode !== 0) throw new Error('Native sign-in failed')
        const status = await claudeStatus(spec, claudeAccountExecutable(), signal)
        if (status.loggedIn !== true || status.authMethod !== 'claude.ai') throw new Error('Native subscription sign-in incomplete')
      } finally {
        child.stdout!.off('data', receive); child.stderr!.off('data', receive)
        await release(child)
      }
    },
  }
}
/** Native Codex driver using only the pinned app-server's account and model methods.
 * @param spec - owning process service and deployment settings.
 * @returns native driver, without starting any process.
 */
export function codexAccountDriver(spec: NativeDriverSpec): NativeAccountDriver {
  return {
    provider: 'codex', label: 'OpenAI Codex', loginModes: ['browser', 'device-code'],
    async describe(signal) {
      const connection = await openCodexConnection({ ...spec, signal })
      try {
        const response = record(await connection.request('account/read', { refreshToken: false }))
        if (response.account === null) return { availability: 'available', status: 'disconnected' }
        const account = record(response.account)
        const authMode = account.type === 'chatgpt' ? 'subscription' : account.type === 'apiKey' ? 'api-key' : undefined
        const models: NativeAccountModel[] = []
        const cursors = new Set<string>()
        let cursor: string | undefined
        do {
          const listing = record(await connection.request('model/list', cursor === undefined ? {} : { cursor }))
          if (!Array.isArray(listing.data)) throw new Error('Invalid native model list')
          for (const value of listing.data) {
            const model = record(value)
            if (model.hidden === true) continue
            models.push({ id: text(model.model), name: text(model.displayName),
              efforts: Array.isArray(model.supportedReasoningEfforts)
                ? model.supportedReasoningEfforts.map(value => text(record(value).reasoningEffort)) : [] })
          }
          cursor = listing.nextCursor === null || listing.nextCursor === undefined ? undefined : text(listing.nextCursor)
          if (cursor !== undefined) {
            if (cursors.has(cursor)) throw new Error('Native model pagination repeated a cursor')
            cursors.add(cursor)
          }
        } while (cursor !== undefined)
        return { availability: 'available', status: 'connected', ...authMode === undefined ? {} : { authMode }, models } satisfies Omit<NativeAccountView, 'provider' | 'label' | 'loginModes' | 'loginInFlight'>
      } finally { await connection.close() }
    },
    async login(mode, signal, notice) {
      const connection = await openCodexConnection({ ...spec, signal })
      try {
        let loginId: string | undefined
        const early: Record<string, unknown>[] = []
        let resolveCompletion!: (value: Record<string, unknown>) => void
        const completion = new Promise<Record<string, unknown>>(resolve => { resolveCompletion = resolve })
        connection.onNotification((method, params) => {
          if (method !== 'account/login/completed') return
          if (loginId === undefined) early.push(params)
          else if (params.loginId === loginId) resolveCompletion(params)
        })
        const response = record(await connection.request('account/login/start', { type: mode === 'device-code' ? 'chatgptDeviceCode' : 'chatgpt' }))
        loginId = text(response.loginId)
        for (const event of early) if (event.loginId === loginId) resolveCompletion(event)
        notice(text(mode === 'device-code' ? response.verificationUrl : response.authUrl),
          mode === 'device-code' ? text(response.userCode) : undefined)
        const abort = new Promise<never>((_resolve, reject) => {
          if (signal.aborted) reject(new Error('Sign-in cancelled'))
          else signal.addEventListener('abort', () => reject(new Error('Sign-in cancelled')), { once: true })
        })
        const settled = await Promise.race([completion, abort, connection.closed.then(() => { throw new Error('Native login process exited') })])
        if (settled.loginId !== loginId || settled.success !== true) throw new Error('Native sign-in failed')
      } finally { await connection.close() }
    },
  }
}
