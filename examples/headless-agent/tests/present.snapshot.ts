/** Keyless application transcript for explicit delivery of an externally generated file. */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeSessionSnapshot } from '@arx-ai/arx-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@arx-ai/arx-loader-smoke'
import type { SessionEvent, SessionHeader } from '@arx-ai/arx-session'
import type {} from '@arx-ai/arx-tool-present/types'

const configPath = fileURLToPath(new URL('./fixtures/fs/tool-present/cordis.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const fixture = fileURLToPath(new URL('./present-snapshots/replay.override.json', import.meta.url))
const expected = fileURLToPath(new URL('./present-snapshots/session.expected.jsonl', import.meta.url))

describe('present through the headless Loader application', () => {
  it('records the delivery and truthful validation result without modifying the source file', async () => {
    const result = await runLoaderSmoke({
      label: 'present file headless snapshot',
      tempDirPrefix: 'arx-present-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'Deliver the existing report.txt file.'],
      tsconfigPath,
      env: { ARX_SNAPSHOT_FILE: fixture, ARX_SNAPSHOT_OVERRIDE: fixture },
      prepare: async (cwd) => {
        await writeFile(join(cwd, 'report.txt'), 'Generated outside the file tools.\n')
      },
      inspect: async (cwd) => {
        expect(await readFile(join(cwd, 'report.txt'), 'utf8')).toBe('Generated outside the file tools.\n')
        const root = join(cwd, '.sessions')
        const files = (await readdir(root, { recursive: true })).filter(path => path.endsWith('.jsonl'))
        expect(files).toHaveLength(1)
        const content = await readFile(join(root, files[0]!), 'utf8')
        const [headerLine, ...eventLines] = content.trim().split('\n')
        const header = JSON.parse(headerLine!) as SessionHeader
        const events = eventLines.map(line => JSON.parse(line) as SessionEvent)
        const delivery = events.filter(event => event.type === 'deliverables/presented')
        expect(delivery.map(event => event.data)).toEqual([{
          turn: 1, callId: 'present-output',
          files: [{ path: 'report.txt', description: 'Report produced outside the file tools.' }],
        }])
        const normalized = normalizeSessionSnapshot(content, { sessionIds: [header.id], cwd })
        if (process.env.ARX_SNAPSHOT === 'refresh') await writeFile(expected, normalized)
        expect(normalized).toBe(await readFile(expected, 'utf8'))
      },
    })
    expect(result.stdout).toContain('Validated file for delivery: report.txt')
    expect(result.stdout).toContain('Current file contents are not copied or preserved.')
    expect(result.stdout).toContain('The report is ready')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
