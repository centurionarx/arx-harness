/** The bump's manifest rewrite and its lockfile step's re-entry into pnpm. */

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyVersions } from './bump.ts'

const MANIFEST = '{\n  "name": "fixture",\n  "version": "1.0.0"\n}\n'
const PLANNED = [{ manifestPath: 'package.json', label: 'package.json', from: '1.0.0', to: '1.0.1', tag: undefined }]
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A repository root with one manifest and a stand-in pnpm entrypoint that
 * records its arguments in its working directory.
 * @param status - exit status the stand-in returns.
 * @returns The root and a lifecycle environment naming the stand-in as `npm_execpath`.
 */
function fixture(status: number): { root: string; environment: NodeJS.ProcessEnv } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'arx-release-bump-')))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), MANIFEST)
  const entrypoint = join(root, 'pnpm.cjs')
  writeFileSync(entrypoint, [
    "require('node:fs').writeFileSync('invocation.json', JSON.stringify(process.argv.slice(2)))",
    `process.exitCode = ${String(status)}`,
  ].join('\n'))
  return { root, environment: { ...process.env, npm_execpath: entrypoint } }
}

describe('version rewrite', () => {
  it('refreshes the lockfile in the root through the pnpm entrypoint that launched the bump', () => {
    const { root, environment } = fixture(0)

    applyVersions(root, PLANNED, environment)

    expect(JSON.parse(readFileSync(join(root, 'invocation.json'), 'utf8'))).toEqual(['install', '--lockfile-only'])
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(MANIFEST.replace('1.0.0', '1.0.1'))
  })

  it('restores the rewritten manifests when the lockfile step fails', () => {
    const { root, environment } = fixture(1)

    expect(() => { applyVersions(root, PLANNED, environment) }).toThrow('exited with 1')
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(MANIFEST)
  })

  it('rewrites nothing when the bump runs outside a pnpm script', () => {
    const { root, environment } = fixture(0)

    expect(() => { applyVersions(root, PLANNED, { ...environment, npm_execpath: undefined }) })
      .toThrow('npm_execpath is unavailable')
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(MANIFEST)
  })
})
