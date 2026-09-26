/** External native-process double; Loader and the account service stay real. */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
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
    const done = new Promise<SubprocessOutcome>((resolve) => { complete = resolve })
    const finish = (): void => { if (!settled) { settled = true; stdout.end(); stderr.end(); complete({ exitCode: 0, signal: null }) } }
    const isStatus = spec.argv.includes('status')
    const status = JSON.stringify({ loggedIn: connected, authMethod: 'claude.ai', accessToken: 'MUST-NOT-LEAK' })
    if (isStatus) queueMicrotask(finish)
    else if (spec.argv.includes('login')) {
      queueMicrotask(() => stdout.write('Open https://claude.com/oauth/authorize?state=test-state\nPaste code here if prompted > '))
      stdin.once('data', (value) => { if (String(value) !== 'fixture-code\n') throw new Error('Unexpected code'); connected = true; finish() })
    } else {
      const reply = (id: string, result: object): void => { stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`) }
      stdin.on('data', (value) => {
        for (const line of String(value).trim().split('\n')) {
          const request = JSON.parse(line) as { id?: string; method: string }
          if (!request.id) continue
          const id = request.id
          if (request.method !== 'account/login/start') {
            reply(id, request.method === 'account/read' ? { account: null } : {})
            continue
          }
          // The app-server's loopback return listener: the callback it receives completes the sign-in.
          const listener = createServer((callback, response) => {
            response.writeHead(302, { location: '/success' }).end()
            listener.close()
            const success = callback.url === '/auth/callback?code=fixture-callback&state=fixture'
            stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'account/login/completed', params: { loginId: 'fixture', success } })}\n`)
          })
          listener.listen(0, '127.0.0.1', () => {
            const redirect = `http://localhost:${String((listener.address() as AddressInfo).port)}/auth/callback`
            reply(id, { type: 'chatgpt', loginId: 'fixture',
              authUrl: `https://auth.openai.com/oauth/authorize?redirect_uri=${encodeURIComponent(redirect)}` })
          })
        }
      })
    }
    spec.signal?.addEventListener('abort', finish, { once: true })
    return { pid: -1, stdin, stdout, stderr, done,
      collected: { stdout: { readFrom: () => ({ text: status, nextOffset: status.length, lossy: false }) } },
      terminate: finish, waitForExit: async () => { await done; return true } }
  }
}
