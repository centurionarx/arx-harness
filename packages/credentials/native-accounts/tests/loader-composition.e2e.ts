import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@arx-ai/arx-loader-smoke'
const fixture = (name: string) => fileURLToPath(new URL(`./fixture/${name}`, import.meta.url))
describe('native account settings composition', () => {
  it('loads the account plugin and completes a manual native sign-in without leaking product output', async () => {
    const { stdout, stderr } = await runLoaderSmoke({ label: 'native account Loader login', tempDirPrefix: 'arx-native-account-',
      binScript: fixture('driver.ts'), libBinScript: fixture('driver.ts'), configPath: fixture('cordis.yml'),
      binArgs: [fixture('cordis.yml')], tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)) })
    expect(stderr).toBe('')
    expect(stdout.trim()).toBe(['Claude Code: disconnected', 'OpenAI Codex: disconnected',
      'Claude Code: browser link and code prompt', 'Claude Code: connected'].join('\n'))
    expect(stdout).not.toContain('MUST-NOT-LEAK')
    expect(stdout).not.toContain('fixture-code')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
