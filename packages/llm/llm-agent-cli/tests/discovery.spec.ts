/**
 * Model discovery: what one vendor run's roster becomes, and what a host with
 * no usable CLI reports instead of an empty list.
 */

import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@arx-ai/arx-subprocess'

const queryMock = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => queryMock(...args) as unknown,
}))

const { discoverModels } = await import('../src/discovery.ts')

/** A spawn seam recording every spec it is handed. */
function recordingSpawn(): { spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle; specs: SubprocessSpawnSpec[] } {
  const specs: SubprocessSpawnSpec[] = []
  return {
    specs,
    spawn: (spec) => {
      specs.push(spec)
      return {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        done: new Promise(() => {}),
        terminate: () => {},
      } as unknown as SubprocessHandle
    },
  }
}

/** One vendor run answering a fixed roster. */
function runWith(rows: unknown, interrupt = vi.fn(() => Promise.resolve())) {
  queryMock.mockReturnValue({ supportedModels: () => Promise.resolve(rows), interrupt })
  return { interrupt }
}

/** The options the single run of one test was started with. */
function startedWith(): Record<string, unknown> {
  expect(queryMock).toHaveBeenCalledOnce()
  return (queryMock.mock.calls[0]?.[0] as { options: Record<string, unknown> }).options
}

beforeEach(() => { queryMock.mockReset() })

describe('discoverModels', () => {
  it('reports the ids and display names the vendor run lists', async () => {
    runWith([
      { value: 'sonnet', displayName: 'Claude Sonnet 5' },
      { value: 'claude-opus-5', displayName: '' },
      { value: 'haiku' },
    ])
    const { spawn } = recordingSpawn()

    await expect(discoverModels({ spawn, cwd: () => '/workspace' })).resolves.toEqual([
      { id: 'sonnet', name: 'Claude Sonnet 5' },
      // An empty display name is not a name; the id is what a surface shows.
      { id: 'claude-opus-5' },
      { id: 'haiku' },
    ])
  })

  it('discloses no capacity, because the vendor rows carry none', async () => {
    runWith([{ value: 'sonnet', displayName: 'Claude Sonnet 5' }])
    const { spawn } = recordingSpawn()

    const [model] = await discoverModels({ spawn, cwd: () => '/workspace' })

    expect(model).not.toHaveProperty('contextWindow')
    expect(model).not.toHaveProperty('maxTokens')
  })

  it('runs in the configured directory with no tools and no skills', async () => {
    runWith([])
    const { spawn } = recordingSpawn()

    await discoverModels({ spawn, cwd: () => '/srv/project' })

    const options = startedWith()
    expect(options['cwd']).toBe('/srv/project')
    expect(options['persistSession']).toBe(false)
    expect(options['skills']).toEqual([])
    expect(options['allowedTools']).toEqual([])
    await expect((options['canUseTool'] as () => Promise<{ behavior: string }>)())
      .resolves.toMatchObject({ behavior: 'deny' })
  })

  it('spawns its CLI through the harness subprocess seam', async () => {
    const { spawn, specs } = recordingSpawn()
    // The SDK spawns while the run starts, not when the roster is asked for,
    // so the spawn has to happen from inside `query` to be the real order.
    queryMock.mockImplementation((request: unknown) => {
      const options = (request as { options: Record<string, unknown> }).options
      void (options['spawnClaudeCodeProcess'] as (o: unknown) => unknown)({
        command: '/usr/bin/claude', args: ['--stdio'], cwd: '/workspace', env: {},
      })
      return { supportedModels: () => Promise.resolve([]), interrupt: () => Promise.resolve() }
    })

    await discoverModels({ spawn, cwd: () => '/workspace' })

    expect(specs).toHaveLength(1)
    expect(specs[0]?.argv).toEqual(['/usr/bin/claude', '--stdio'])
    expect(specs[0]?.cwd).toBe('/workspace')
    // The same grace a request's run gets: discovery owns a process tree too.
    expect(specs[0]?.graceMs).toBe(3_000)
  })

  it('releases the run whether the roster arrives or fails', async () => {
    const { interrupt } = runWith([{ value: 'sonnet' }])
    const { spawn } = recordingSpawn()
    await discoverModels({ spawn, cwd: () => '/workspace' })
    expect(interrupt).toHaveBeenCalledOnce()

    const failing = vi.fn(() => Promise.resolve())
    queryMock.mockReturnValue({
      supportedModels: () => Promise.reject(new Error('not logged in')),
      interrupt: failing,
    })

    await expect(discoverModels({ spawn, cwd: () => '/workspace' })).rejects.toThrow('not logged in')
    expect(failing).toHaveBeenCalledOnce()
  })

  it('reports the roster failure even when the run cannot be interrupted', async () => {
    queryMock.mockReturnValue({
      supportedModels: () => Promise.reject(new Error('claude: command not found')),
      interrupt: () => Promise.reject(new Error('already gone')),
    })
    const { spawn } = recordingSpawn()

    // The failure a surface must show is the one that answers the question,
    // not the teardown that followed it.
    await expect(discoverModels({ spawn, cwd: () => '/workspace' }))
      .rejects.toThrow('claude: command not found')
  })
})
