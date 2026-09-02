import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { basePatchPlatformGating, lefthookShellJobs, skillPosixSyntax, windowsGateShellScripts } from './verify-windows-parity.ts'

const basePatchFixture = `
    - id: bash-sandbox
      name: '@arx-ai/arx-bash-sandbox'
      disabled: !!js process.platform === 'win32'
      config:
        timeoutMs: 60000

    - id: pwsh-sandbox
      name: '@arx-ai/arx-pwsh-sandbox'
      disabled: !!js process.platform !== 'win32'

    - id: tool-bash
      name: '@arx-ai/arx-tool-bash'
      disabled: !!js process.platform === 'win32'

    - id: tool-pwsh
      name: '@arx-ai/arx-tool-pwsh'
      disabled: !!js process.platform !== 'win32'
`

describe('basePatchPlatformGating', () => {
  it('accepts complementary win32 rungs for every watched row', () => {
    expect(basePatchPlatformGating(basePatchFixture)).toEqual([])
  })

  it('fails loud when a rung is dropped', () => {
    const dropped = basePatchFixture.replace("      disabled: !!js process.platform === 'win32'\n      config:\n        timeoutMs", '      config:\n        timeoutMs')
    const findings = basePatchPlatformGating(dropped)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.subject).toContain('row bash-sandbox')
    expect(findings[0]?.hint).toContain('the complementary win32 rung of the bash family')
  })

  it('fails loud when a rung drifts', () => {
    const drifted = basePatchFixture.replace("=== 'win32'", "!== 'win32'")
    expect(basePatchPlatformGating(drifted).map(f => f.subject)).toEqual([
      'packages/bundle/base/cordis.patch.yml row bash-sandbox',
    ])
  })

  it('keeps the shipped base patch green', () => {
    const patch = readFileSync(join(import.meta.dirname, '../packages/bundle/base/cordis.patch.yml'), 'utf8')
    expect(basePatchPlatformGating(patch)).toEqual([])
  })
})

describe('lefthookShellJobs', () => {
  it('flags run jobs naming shell scripts but exempts tsx jobs', () => {
    const findings = lefthookShellJobs([
      'pre-commit:',
      '  jobs:',
      '    - name: notes',
      '      run: node_modules/.bin/tsx scripts/verify-archived-agent-notes.ts',
      '',
      '    - name: vendor manifest guard',
      '      run: scripts/check-vendor-manifest.sh',
    ].join('\n'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.subject).toContain('check-vendor-manifest.sh')
  })

  it('keeps the ported lefthook green', () => {
    const lefthook = readFileSync(join(import.meta.dirname, '../lefthook.yml'), 'utf8')
    expect(lefthookShellJobs(lefthook)).toEqual([])
  })
})

describe('windowsGateShellScripts', () => {
  it('keeps every Windows-lane gate free of POSIX-shell commands', () => {
    expect(windowsGateShellScripts()).toEqual([])
  })
})

describe('skillPosixSyntax', () => {
  it('flags POSIX-only bash blocks without a pwsh variant', () => {
    const findings = skillPosixSyntax('skills/demo/SKILL.md', [
      '## Usage',
      '',
      '```bash',
      'bash scripts/whatever.sh',
      '```',
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.subject).toContain('skills/demo/SKILL.md:3')
    expect(findings[0]?.hint).toContain('```pwsh')
  })

  it('accepts a POSIX-only block when the file documents a pwsh variant', () => {
    expect(skillPosixSyntax('skills/demo/SKILL.md', [
      '```bash',
      'bash scripts/whatever.sh',
      '```',
      '',
      'Windows variant:',
      '',
      '```powershell',
      'Get-Content README.md',
      '```',
    ])).toEqual([])
  })

  it('ignores pnpm/node commands and non-shell fences', () => {
    expect(skillPosixSyntax('skills/demo/SKILL.md', [
      '```bash',
      'pnpm run test && pnpm run build',
      'node ./scripts/tool.ts --flag',
      '```',
      '',
      '```yaml',
      'key: value',
      '```',
    ])).toEqual([])
  })
})
