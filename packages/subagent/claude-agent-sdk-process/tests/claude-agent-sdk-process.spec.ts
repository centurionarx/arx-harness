import type { SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { scrubbedParentEnv } from '@arx-ai/arx-subprocess'
import { describe, expect, it } from 'vitest'

import { claudeSpawnSpec, sdkEnvironmentOverlay } from '../src/index.ts'

/** One SDK spawn request with every field the projection reads. */
function spawnOptions(overrides: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    command: '/sdk/claude',
    args: ['--output-format', 'stream-json'],
    cwd: '/workspace',
    env: { PATH: '/usr/bin' },
    ...overrides,
  } as SpawnOptions
}

describe('sdkEnvironmentOverlay', () => {
  it('states the whole environment rather than a diff against ambient state', () => {
    const ambient = Object.keys(scrubbedParentEnv())
    expect(ambient.length).toBeGreaterThan(0)
    const overlay = sdkEnvironmentOverlay({ PATH: '/usr/bin' })
    expect(overlay['PATH']).toBe('/usr/bin')
    for (const name of ambient) {
      if (name === 'PATH') continue
      expect(name in overlay).toBe(true)
      expect(overlay[name]).toBeUndefined()
    }
  })

  it('keeps an ambient name the SDK chose to carry forward', () => {
    const carried = Object.keys(scrubbedParentEnv())[0]
    expect(carried).toBeDefined()
    const overlay = sdkEnvironmentOverlay({ [carried!]: 'kept' })
    expect(overlay[carried!]).toBe('kept')
  })
})

describe('claudeSpawnSpec', () => {
  it('translates the request into an explicit subprocess spec', () => {
    const signal = new AbortController().signal
    const spec = claudeSpawnSpec(spawnOptions({ signal }), 3_000)
    expect(spec.argv).toEqual(['/sdk/claude', '--output-format', 'stream-json'])
    expect(spec.cwd).toBe('/workspace')
    expect(spec.graceMs).toBe(3_000)
    expect(spec.signal).toBe(signal)
    expect(spec.stdio).toEqual({ stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' })
  })

  it('refuses a request that names no workspace instead of defaulting to one', () => {
    const { cwd: _omitted, ...absent } = spawnOptions()
    expect(() => claudeSpawnSpec(absent as SpawnOptions, 3_000)).toThrow(/omitted its workspace/)
    expect(() => claudeSpawnSpec(spawnOptions({ cwd: '' }), 3_000)).toThrow(/omitted its workspace/)
  })
})
