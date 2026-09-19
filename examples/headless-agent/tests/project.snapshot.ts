/** Keyless application transcript for the durable project catalog. */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeSessionSnapshot } from '@arx-ai/arx-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@arx-ai/arx-loader-smoke'
import type { SessionHeader } from '@arx-ai/arx-session'

const configPath = fileURLToPath(new URL('./fixtures/project/tool-project/cordis.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const fixture = fileURLToPath(new URL('./project-snapshots/replay.override.json', import.meta.url))
const expected = fileURLToPath(new URL('./project-snapshots/session.expected.jsonl', import.meta.url))

describe('project through the headless Loader application', () => {
  it('logs the project guidance, catalog result and final response through real storage services', async () => {
    const result = await runLoaderSmoke({
      label: 'project catalog headless snapshot',
      tempDirPrefix: 'arx-project-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'List the saved projects before planning any work.'],
      tsconfigPath,
      env: { ARX_SNAPSHOT_FILE: fixture, ARX_SNAPSHOT_OVERRIDE: fixture },
      inspect: async (cwd) => {
        const root = join(cwd, '.sessions')
        const files = (await readdir(root, { recursive: true })).filter(path => path.endsWith('.jsonl'))
        expect(files).toHaveLength(1)
        const content = await readFile(join(root, files[0]!), 'utf8')
        const header = JSON.parse(content.split('\n')[0]!) as SessionHeader
        const normalized = normalizeSessionSnapshot(content, { sessionIds: [header.id], cwd })
        if (process.env.ARX_SNAPSHOT === 'refresh') await writeFile(expected, normalized)
        expect(normalized).toBe(await readFile(expected, 'utf8'))
        expect(content).toContain('project-list')
        expect(content).toContain('expected_version')
        expect(content).toContain('trusted')
      },
    })
    expect(result.stdout).toContain('No saved projects were returned.')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
