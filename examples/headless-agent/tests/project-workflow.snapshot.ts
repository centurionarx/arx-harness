/** Saved workflows through the real Loader application and in-process spawn. */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeSessionSnapshot } from '@arx-ai/arx-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@arx-ai/arx-loader-smoke'
import type { SessionHeader } from '@arx-ai/arx-session'

const configPath = fileURLToPath(new URL('./fixtures/project/project-runner/cordis.yml', import.meta.url))
const binScript = fileURLToPath(new URL('../../../packages/project/project-runner/tests/workflow-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const goldenRoot = fileURLToPath(new URL('./project-snapshots/', import.meta.url))

describe('saved workflows in the headless application', () => {
  it.each(['automatic', 'manual'] as const)('%s execution completes with a real non-top-level child', async (mode) => {
    const result = await runLoaderSmoke({
      label: `project ${mode} workflow snapshot`, tempDirPrefix: 'arx-project-workflow-',
      binScript, libBinScript: binScript, configPath,
      binArgs: [configPath, mode], tsconfigPath,
      inspect: async (cwd) => {
        const root = join(cwd, '.sessions')
        const files = (await readdir(root, { recursive: true })).filter(path => path.endsWith('.jsonl'))
        expect(files).toHaveLength(2)
        const logs = await Promise.all(files.map(async (path) => {
          const content = await readFile(join(root, path), 'utf8')
          return { content, header: JSON.parse(content.split('\n')[0]!) as SessionHeader }
        }))
        const parent = logs.find(log => log.header.parentSession === undefined)!
        const child = logs.find(log => log.header.parentSession === parent.header.id)!
        expect(child.header.cwd).toBe(parent.header.cwd)
        expect(child.content).toContain('Child completed saved task.')
        expect(parent.content).toContain('Workflow completed.')
        expect(parent.content).toContain(mode === 'automatic' ? 'execute_workflow' : 'attach_workflow_step_session')
        const sessionIds = [parent.header.id, child.header.id]
        for (const [role, log] of [['parent', parent], ['child', child]] as const) {
          const expected = join(goldenRoot, `${mode}.${role}.expected.jsonl`)
          const normalized = normalizeSessionSnapshot(log.content, { cwd, sessionIds })
          if (process.env.ARX_SNAPSHOT === 'refresh') await writeFile(expected, normalized)
          expect(normalized).toBe(await readFile(expected, 'utf8'))
        }
      },
    })
    expect(result.stdout).toContain(JSON.stringify({ mode, state: 'completed', topLevelSessions: 1 }))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
