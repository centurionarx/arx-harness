/** External native-process double; Loader and the account service stay real. */
import { PassThrough } from 'node:stream'
import { Context, Service } from '@arx-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'
let connected = false
export default class FixtureSubprocess extends Service {
  constructor(ctx: Context) { super(ctx, 'subprocess') }
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough()
    let complete!: (outcome: SubprocessOutcome) => void
    let settled = false
    const done = new Promise<SubprocessOutcome>(resolve => { complete = resolve })
    const finish = (): void => { if (!settled) { settled = true; stdout.end(); stderr.end(); complete({ exitCode: 0, signal: null }) } }
    const isStatus = spec.argv.includes('status')
    const status = JSON.stringify({ loggedIn: connected, authMethod: 'claude.ai', accessToken: 'MUST-NOT-LEAK' })
    if (isStatus) queueMicrotask(finish)
    else if (spec.argv.includes('login')) {
      queueMicrotask(() => stdout.write('Open https://claude.com/oauth/authorize?state=test-state\nPaste code here if prompted > '))
      stdin.once('data', value => { if (String(value) !== 'fixture-code\n') throw new Error('Unexpected code'); connected = true; finish() })
    } else {
      stdin.on('data', value => {
        for (const line of String(value).trim().split('\n')) {
          const request = JSON.parse(line) as { id?: string; method: string }
          if (!request.id) continue
          const result = request.method === 'account/read' ? { account: null } : {}
          stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
        }
      })
    }
    spec.signal?.addEventListener('abort', finish, { once: true })
    return { pid: -1, stdin, stdout, stderr, done,
      collected: { stdout: { readFrom: () => ({ text: status, nextOffset: status.length, lossy: false }) } },
      terminate: finish, waitForExit: async () => { await done; return true } }
  }
}
