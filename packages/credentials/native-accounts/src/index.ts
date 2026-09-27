/** Native product accounts: status and bounded user-driven login without copying credentials. */
import { Context, Service } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import type {} from '@arx-ai/arx-subprocess'
import { NativeAccountManager } from './manager.ts'
import { claudeAccountDriver, codexAccountDriver } from './drivers.ts'
import type { NativeAccountAttempt, NativeAccountAttemptId, NativeAccountProvider, NativeAccountView, NativeLoginMode } from './types.ts'
export type { NativeAccountAttempt, NativeAccountAttemptId, NativeAccountProvider, NativeAccountView, NativeLoginInput, NativeLoginMode, NativeAccountModel } from './types.ts'
export { NativeAccountError } from './manager.ts'

declare module '@arx-ai/cordis' { interface Context { nativeAccounts: NativeAccounts } }
/** Deployment-owned process and login limits. */
export interface Config {
  /** Working directory the native tools run in; absent, the harness process's own. */
  cwd?: string
  /** Variables laid over the subprocess service's credential-scrubbed environment for every native tool run. */
  env: Record<string, string>
  /** Milliseconds a native process tree gets to exit after termination before it is killed. */
  graceMs: number
  /**
   * Bound on the output kept from one native command: status output in bytes,
   * and the trailing sign-in output scanned for an address and a code prompt.
   */
  outputMaxBytes: number
  /** Milliseconds a sign-in may run before it expires and its native process is withdrawn. */
  loginTimeoutMs: number
  /** Milliseconds one account-status read may take before its probes are withdrawn and the account reports `unknown`. */
  probeTimeoutMs: number
  /** Milliseconds a settled sign-in stays readable through its attempt id. */
  resultRetentionMs: number
  /** Milliseconds the browser waits between progress reads, advised in every attempt. */
  pollIntervalMs: number
  /** Most sign-in attempts held at once, running and retained together. */
  maxAttempts: number
}
/** Account lifecycle service; official products remain the only writers of their credentials. */
export default class NativeAccounts extends Service {
  static inject = ['subprocess']
  static Config: z<Config> = z.object({
    cwd: z.string(),
    env: z.dict(z.string()).default({}),
    graceMs: z.number().min(1).max(2147483647).default(3000),
    outputMaxBytes: z.number().min(1024).max(1048576).default(65536),
    loginTimeoutMs: z.number().min(1).max(2147483647).default(600000),
    probeTimeoutMs: z.number().min(1).max(2147483647).default(15000),
    resultRetentionMs: z.number().min(1).max(2147483647).default(60000),
    maxAttempts: z.number().step(1).min(1).max(1024).default(32),
    pollIntervalMs: z.number().min(100).max(60000).default(1000),
  })
  private readonly manager: NativeAccountManager
  constructor(ctx: Context, config: Config) {
    super(ctx, 'nativeAccounts')
    const spec = { ...config, cwd: config.cwd ?? process.cwd(), spawn: ctx.subprocess.spawn.bind(ctx.subprocess) }
    this.manager = new NativeAccountManager([claudeAccountDriver(spec), codexAccountDriver(spec)], config)
    ctx.effect(() => () => this.manager.dispose(), 'native account attempt teardown')
  }
  /** Read sanitized account and native model metadata.
   * @returns bounded native probes without token material or account identifiers.
   */
  describe(): Promise<NativeAccountView[]> { return this.manager.describe() }
  /** Begin user-authorized native login.
   * @param provider - product selected by the human.
   * @param mode - supported browser or device-code flow.
   * @returns a private attempt capability and initial progress.
   */
  begin(provider: NativeAccountProvider, mode?: NativeLoginMode): NativeAccountAttempt { return this.manager.begin(provider, mode) }
  /** Read the initiating surface's attempt.
   * @param id - private capability returned by begin.
   * @returns sanitized progress.
   */
  poll(id: NativeAccountAttemptId): NativeAccountAttempt { return this.manager.poll(id) }
  /** Answer the official CLI's manual-code prompt.
   * @param id - initiating surface's private capability.
   * @param code - transient single-line authorization code.
   * @returns progress without the submitted value.
   */
  submit(id: NativeAccountAttemptId, code: string): NativeAccountAttempt { return this.manager.submit(id, code) }
  /** Cancel one owned attempt and await native process cleanup.
   * @param id - initiating surface's private capability.
   * @returns terminal progress.
   */
  cancel(id: NativeAccountAttemptId): Promise<NativeAccountAttempt> { return this.manager.cancel(id) }
}
