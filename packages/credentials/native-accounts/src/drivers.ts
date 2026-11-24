/** Native product adapters. Only allowlisted account facts leave these process boundaries. */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { access } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { claudeSpawnSpec, ManagedClaudeCodeProcess } from '@arx-ai/arx-claude-agent-sdk-process'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'
import type { NativeAccountDriver } from './manager.ts'
import type { NativeAccountModel, NativeAccountView, NativeLoginInput } from './types.ts'
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
/** Hosts of the Claude sign-in pages; the CLI's other output links are not relayed. */
const CLAUDE_AUTHORIZATION_HOSTS = ['claude.com', 'claude.ai', 'console.anthropic.com', 'platform.claude.com'] as const
/** Host of the ChatGPT sign-in pages the Codex app-server returns. */
const CODEX_AUTHORIZATION_HOSTS = ['auth.openai.com'] as const
/** Hosts a Codex browser sign-in may name as its return address; both denote this host's loopback. */
const CODEX_CALLBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1']
/** Operating-system facts that select the Claude Agent SDK's platform package. */
export interface ClaudePlatform {
  platform: NodeJS.Platform
  arch: string
  /** Linux without a glibc runtime, which the SDK serves from its `-musl` package. */
  musl: boolean
}
/** Name the SDK platform package and executable for one operating system.
 * @param host - platform, architecture, and C library of the running Node.
 * @returns the optional-dependency package name and the executable file inside it.
 */
export function claudePlatformExecutable(host: ClaudePlatform): { pkg: string; file: string } {
  return { pkg: `@anthropic-ai/claude-agent-sdk-${host.platform}-${host.arch}${host.musl ? '-musl' : ''}`,
    file: host.platform === 'win32' ? 'claude.exe' : 'claude' }
}
/** Resolve the native platform package shipped with the same pinned Claude Agent SDK.
 * @returns the installed platform executable; no PATH or global installation fallback.
 */
export function claudeAccountExecutable(): string {
  const sdkRequire = createRequire(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk'))
  const musl = process.platform === 'linux'
    && (process.report.getReport() as { header?: { glibcVersionRuntime?: string } }).header?.glibcVersionRuntime === undefined
  const { pkg, file } = claudePlatformExecutable({ platform: process.platform, arch: process.arch, musl })
  return join(dirname(sdkRequire.resolve(`${pkg}/package.json`)), file)
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
    const output = (child.collected.stdout as NonNullable<SubprocessHandle['collected']['stdout']>).readFrom(0)
    if (output.lossy) throw new Error('Native status exceeded its limit')
    return record(JSON.parse(output.text))
  } finally { await release(child) }
}
async function claudeModels(spec: NativeDriverSpec, signal: AbortSignal): Promise<NativeAccountModel[]> {
  signal.throwIfAborted()
  const controller = new AbortController()
  const ended = new Promise<void>((resolve) => { controller.signal.addEventListener('abort', () => { resolve() }, { once: true }) })
  const abort = (): void => { controller.abort() }
  signal.addEventListener('abort', abort, { once: true })
  const children: SubprocessHandle[] = []
  // An input that stays open without messages until discovery ends allows
  // initialize/supportedModels without a paid model turn.
  async function* noMessages(): AsyncGenerator<never> { await ended }
  const conversation = query({ prompt: noMessages(), options: {
    cwd: spec.cwd, env: spec.env, abortController: controller, persistSession: false,
    permissionMode: 'dontAsk', tools: [], skills: [],
    spawnClaudeCodeProcess: (options) => {
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
    provider: 'claude-code', label: 'Claude Code', loginModes: ['browser'], authorizationHosts: CLAUDE_AUTHORIZATION_HOSTS,
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
    login(_mode, signal, notice, prompt) {
      return codePromptSignIn(spec, () => [claudeAccountExecutable(), 'auth', 'login', '--claudeai'], {
        hosts: CLAUDE_AUTHORIZATION_HOSTS, codePrompt: 'Paste code here if prompted >',
        async confirm() {
          const status = await claudeStatus(spec, claudeAccountExecutable(), signal)
          if (status.loggedIn !== true || status.authMethod !== 'claude.ai') throw new Error('Native subscription sign-in incomplete')
        },
      }, signal, notice, prompt)
    },
  }
}
/** What distinguishes one product's terminal sign-in that prints an address and then asks for a pasted code. */
interface CodePromptSignIn {
  /** Exact HTTPS hosts whose addresses are relayed; the CLI's other output links are not. */
  hosts: readonly string[]
  /** Text the CLI prints when it waits for the pasted code. */
  codePrompt: string
  /** Confirms, after a zero exit, that the product now holds the expected sign-in. */
  confirm(): Promise<void>
}
/**
 * Run one terminal sign-in: relay the product's sign-in addresses, answer its
 * code prompt once with the person's pasted line, and require a zero exit
 * followed by the product's own confirmation.
 * @param spec - owning process service and deployment settings.
 * @param argv - resolves the product's sign-in command once the attempt is known to be live.
 * @param product - the product's sign-in hosts, prompt text, and confirmation.
 * @param signal - the attempt's lifetime; aborting it terminates the CLI.
 * @param notice - receives each relayed address.
 * @param prompt - asks the person for the pasted code.
 */
async function codePromptSignIn(
  spec: NativeDriverSpec, argv: () => string[], product: CodePromptSignIn, signal: AbortSignal,
  notice: (url: string) => void, prompt: (input: NativeLoginInput) => Promise<string>,
): Promise<void> {
  signal.throwIfAborted()
  const child = spec.spawn({ argv: argv(), cwd: spec.cwd, env: spec.env, signal, graceMs: spec.graceMs,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' } })
  const stdin = child.stdin as NonNullable<SubprocessHandle['stdin']>
  const stdout = child.stdout as NonNullable<SubprocessHandle['stdout']>
  const stderr = child.stderr as NonNullable<SubprocessHandle['stderr']>
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
        if (product.hosts.includes(host)) notice(url)
      }
      if (!prompting && tail.includes(product.codePrompt)) {
        prompting = true
        answer = prompt('code').then((code) => { if (!signal.aborted) stdin.write(`${code}\n`) })
        void answer.catch(() => { /* Cancellation is awaited through process cleanup below. */ })
      }
    } catch (error) { parseError = error; child.terminate() }
  }
  stdout.on('data', receive); stderr.on('data', receive)
  try {
    const result = await child.done
    signal.throwIfAborted()
    if (parseError !== undefined) throw new Error('Native sign-in output could not be relayed', { cause: parseError })
    if (result.exitCode !== 0) throw new Error('Native sign-in failed')
    await product.confirm()
  } finally {
    stdout.off('data', receive); stderr.off('data', receive)
    await release(child)
  }
}
/**
 * The return address of a Codex browser sign-in: the `redirect_uri` of its
 * authorization address, which the app-server serves on this host's loopback.
 * The port is read from the address because the app-server moves to a
 * fallback port when its default one is taken.
 * @param authUrl - the authorization address the app-server returned.
 * @returns the loopback HTTP return address, or `undefined` when the address names none.
 */
function codexCallback(authUrl: string): URL | undefined {
  const value = new URL(authUrl).searchParams.get('redirect_uri')
  if (value === null || !URL.canParse(value)) return undefined
  const callback = new URL(value)
  return callback.protocol === 'http:' && CODEX_CALLBACK_HOSTS.includes(callback.hostname) && callback.port !== ''
    ? callback : undefined
}
/**
 * The query of an address the person pasted, when it is this sign-in's return address.
 * @param answer - one pasted line.
 * @param callback - the sign-in's return address.
 * @returns the query to forward, or `undefined` for any other address or text.
 */
function pastedCallbackQuery(answer: string, callback: URL): string | undefined {
  const trimmed = answer.trim()
  if (!URL.canParse(trimmed)) return undefined
  const pasted = new URL(trimmed)
  return pasted.protocol === callback.protocol && pasted.hostname === callback.hostname && pasted.port === callback.port
    && pasted.pathname === callback.pathname && pasted.search !== '' ? pasted.search : undefined
}
/**
 * Forward pasted return addresses to the app-server's own callback listener
 * until one is accepted; each prompt after the first says the previous paste
 * was not accepted. A browser on another machine cannot reach this host's
 * loopback, so the sign-in page's final address arrives through the person
 * instead; only its query leaves the prompt, and only toward the port the
 * sign-in named. The app-server then completes the sign-in as if the browser
 * had reached it.
 * @param callback - the sign-in's return address.
 * @param prompt - asks the person for one pasted line; rejects when the attempt ends.
 * @param signal - the attempt's lifetime.
 */
async function relayPastedCallbacks(
  callback: URL, prompt: (input: NativeLoginInput, rejected?: boolean) => Promise<string>, signal: AbortSignal,
): Promise<void> {
  let rejected = false
  for (;;) {
    const query = pastedCallbackQuery(await prompt('redirect-url', rejected), callback)
    rejected = true
    if (query === undefined) continue
    let response: Response
    try {
      // The listener binds the IPv4 loopback address, while `localhost` may resolve to `::1` first.
      response = await fetch(`http://127.0.0.1:${callback.port}${callback.pathname}${query}`, { redirect: 'manual', signal })
    } catch {
      // Swallowed: a listener that is gone has settled the sign-in or will fail it through
      // the app-server, and an aborted attempt rejects the next prompt; asking again is the only step left.
      continue
    }
    await response.body?.cancel()
    // A refused answer, such as an address from an earlier attempt, leaves the listener waiting.
    if (response.status < 400) return
  }
}
/** Native Codex driver using only the pinned app-server's account and model methods. A browser
 * sign-in also accepts the pasted address of its return page, for a browser on another machine.
 * @param spec - owning process service and deployment settings.
 * @returns native driver, without starting any process.
 */
export function codexAccountDriver(spec: NativeDriverSpec): NativeAccountDriver {
  return {
    provider: 'codex', label: 'OpenAI Codex', loginModes: ['browser', 'device-code'], authorizationHosts: CODEX_AUTHORIZATION_HOSTS,
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
    async login(mode, signal, notice, prompt) {
      const connection = await openCodexConnection({ ...spec, signal })
      try {
        // Completions can arrive before the start request answers with its id.
        const login: { id?: string } = {}
        const early: Record<string, unknown>[] = []
        let resolveCompletion!: (value: Record<string, unknown>) => void
        const completion = new Promise<Record<string, unknown>>((resolve) => { resolveCompletion = resolve })
        connection.onNotification((method, params) => {
          if (method !== 'account/login/completed') return
          if (login.id === undefined) early.push(params)
          else if (params.loginId === login.id) resolveCompletion(params)
        })
        const response = record(await connection.request('account/login/start', { type: mode === 'device-code' ? 'chatgptDeviceCode' : 'chatgpt' }))
        const loginId = text(response.loginId)
        login.id = loginId
        for (const event of early) if (event.loginId === loginId) resolveCompletion(event)
        const url = text(mode === 'device-code' ? response.verificationUrl : response.authUrl)
        notice(url, mode === 'device-code' ? text(response.userCode) : undefined)
        const callback = mode === 'browser' ? codexCallback(url) : undefined
        if (callback !== undefined) {
          void relayPastedCallbacks(callback, prompt, signal).catch(() => {
            // Swallowed: the prompt rejects once the attempt settles, which is how the relay ends.
          })
        }
        const abort = new Promise<never>((_resolve, reject) => {
          if (signal.aborted) reject(new Error('Sign-in cancelled'))
          else signal.addEventListener('abort', () => { reject(new Error('Sign-in cancelled')) }, { once: true })
        })
        const settled = await Promise.race([completion, abort, connection.closed.then(() => { throw new Error('Native login process exited') })])
        if (settled.loginId !== loginId || settled.success !== true) throw new Error('Native sign-in failed')
      } finally { await connection.close() }
    },
  }
}
/** Host of the Google sign-in page the Antigravity CLI prints for a terminal sign-in. */
const ANTIGRAVITY_AUTHORIZATION_HOSTS = ['accounts.google.com'] as const
/** Text the Antigravity CLI prints when it waits for the pasted authorization code. */
const ANTIGRAVITY_CODE_PROMPT = 'Then paste the authorization code, or the full URL of the page you land on, and press Enter:'
/** Diagnostic `agy models` writes to stderr, with exit code 1, when no account is signed in. */
const ANTIGRAVITY_SIGNED_OUT = 'Please sign in to view available models.'
/** Model ids `agy --model` accepts: one token without whitespace. */
const ANTIGRAVITY_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/
/**
 * Read the signed-in account's models with `agy models`, which needs no model turn.
 * @param spec - owning process service and deployment settings.
 * @param executable - the configured Antigravity CLI.
 * @param signal - the probe's lifetime.
 * @returns the listing's lines, or `undefined` when the CLI reports no signed-in account.
 */
async function antigravityListing(spec: NativeDriverSpec, executable: string, signal: AbortSignal): Promise<string[] | undefined> {
  signal.throwIfAborted()
  const child = spec.spawn({ argv: [executable, 'models'], cwd: spec.cwd, env: spec.env, signal, graceMs: spec.graceMs,
    stdio: { stdin: 'ignore', stdout: { maxBytes: spec.outputMaxBytes }, stderr: { maxBytes: spec.outputMaxBytes } } })
  try {
    const result = await child.done
    signal.throwIfAborted()
    const collected = child.collected as Required<SubprocessHandle['collected']>
    const stdout = collected.stdout.readFrom(0)
    const stderr = collected.stderr.readFrom(0)
    if (stdout.lossy || stderr.lossy) throw new Error('Native status exceeded its limit')
    if (result.exitCode === 1 && stderr.text.includes(ANTIGRAVITY_SIGNED_OUT)) return undefined
    if (result.exitCode !== 0) throw new Error('Native status unavailable')
    return stdout.text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
  } finally { await release(child) }
}
/**
 * Project `agy models` lines: each line names one model by its first token,
 * and the rest of the line, when present, is its display name.
 * @param lines - the non-empty listing lines.
 * @returns the models, or `undefined` when a line does not start with a model id.
 */
function antigravityModels(lines: readonly string[]): NativeAccountModel[] | undefined {
  const models: NativeAccountModel[] = []
  for (const line of lines) {
    const [id = '', ...rest] = line.split(/\s+/)
    if (!ANTIGRAVITY_MODEL_ID.test(id)) return undefined
    models.push({ id, name: rest.length === 0 ? id : rest.join(' ') })
  }
  return models
}
/**
 * Native Antigravity CLI driver. The CLI installs outside any package manager
 * and updates itself, so the deployment names its executable; without one the
 * product reports unavailable. Sign-in runs `agy acp --login`, whose Google
 * page shows a code the person pastes back.
 * @param spec - owning process service and deployment settings.
 * @param executable - absolute path of the installed `agy`, or `undefined` when none is configured.
 * @returns native driver, without starting any process.
 */
export function antigravityAccountDriver(spec: NativeDriverSpec, executable: string | undefined): NativeAccountDriver {
  return {
    provider: 'antigravity', label: 'Antigravity CLI', loginModes: ['browser'], authorizationHosts: ANTIGRAVITY_AUTHORIZATION_HOSTS,
    async describe(signal) {
      if (executable === undefined) return { availability: 'unavailable', status: 'unknown' }
      try { await access(executable) }
      catch { return { availability: 'unavailable', status: 'unknown' } }
      const lines = await antigravityListing(spec, executable, signal)
      if (lines === undefined) return { availability: 'available', status: 'disconnected' }
      const models = antigravityModels(lines)
      return { availability: 'available', status: 'connected', ...models === undefined ? {} : { models } }
    },
    async login(_mode, signal, notice, prompt) {
      if (executable === undefined) throw new Error('Native product unavailable')
      await codePromptSignIn(spec, () => [executable, 'acp', '--login'], {
        hosts: ANTIGRAVITY_AUTHORIZATION_HOSTS, codePrompt: ANTIGRAVITY_CODE_PROMPT,
        async confirm() {
          if (await antigravityListing(spec, executable, signal) === undefined) throw new Error('Native sign-in incomplete')
        },
      }, signal, notice, prompt)
    },
  }
}
