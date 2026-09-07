import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectConfigSourceOwnershipViolations } from './verify-config-source-ownership.ts'

const roots: string[] = []

const RUNTIME_COMPOSITION = 'python/sdk-runtime/src/arx_harness_runtime/runtime/cordis.yml'

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function violation(file: string, line: number): string {
  return `${file}:${String(line)}: inlines a credential or endpoint from the environment.`
    + ' The adapter resolves apiKeyEnv through ctx.credentials and takes the endpoint from the route'
    + ' or the installed catalog; inlining here bypasses the credential ladder and hides who set the endpoint.'
}

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'arx-config-source-ownership-'))
  roots.push(root)
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  return root
}

describe('configuration source ownership gate', () => {
  it('rejects inline endpoints in shipped bundle patches', () => {
    const root = tree({
      'packages/subagent/subagent-claude-code/cordis.patch.yml':
        'config:\n  baseURL: !!js process.env.DEEPSEEK_SEARCH_BASE_URL\n',
    })

    expect(collectConfigSourceOwnershipViolations(root)).toEqual([
      violation('packages/subagent/subagent-claude-code/cordis.patch.yml', 2),
    ])
  })

  it('lets the SDK runtime composition follow the launching endpoint and nothing else', () => {
    const root = tree({
      [RUNTIME_COMPOSITION]:
        'baseURL: !!js process.env.DEEPSEEK_BASE_URL\napiKeyEnv: !!js process.env.KEY_NAME\n',
    })

    expect(collectConfigSourceOwnershipViolations(root)).toEqual([violation(RUNTIME_COMPOSITION, 2)])
  })

  it('does not extend the endpoint exemption to another Python composition', () => {
    const root = tree({
      'python/other/src/pkg/runtime/cordis.yml': 'baseURL: !!js process.env.DEEPSEEK_BASE_URL\n',
    })

    expect(collectConfigSourceOwnershipViolations(root)).toEqual([
      violation('python/other/src/pkg/runtime/cordis.yml', 1),
    ])
  })

  it('skips the executable build output copied under runtime/node', () => {
    const root = tree({
      'python/sdk-runtime/src/arx_harness_runtime/runtime/node/src/arx_harness_runtime/runtime/cordis.yml':
        'apiKey: !!js process.env.DEEPSEEK_API_KEY\n',
    })

    expect(collectConfigSourceOwnershipViolations(root)).toEqual([])
  })
})
