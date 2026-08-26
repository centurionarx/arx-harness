import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertClientBuildEnvironment,
  clientBuildEnvironmentDefines,
  clientBuildProcessEnvironment,
  readClientBuildRecord,
  repositoryCommitHash,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { clientBundle } from '../packages/client/tsdown.client.ts'

const root = resolve(import.meta.dirname, '..')
const PROBE_NAME = 'ARX_CLIENT_BUILD_TEST'
const COMMIT_HASH = '0123456789abcdef0123456789abcdef01234567'
const PROBE_KEY = `process.env.${PROBE_NAME}`
const originalProbe = process.env[PROBE_NAME]
const roots: string[] = []
const arxBuildWorkflows = [
  'build-exe-for-python-sdk.yml',
  'ci.yml',
  'e2b-e2e.yml',
  'e2e.yml',
  'release.yml',
  'release-publish.yml',
  'sandbox.yml',
]

afterEach(() => {
  if (originalProbe === undefined) Reflect.deleteProperty(process.env, PROBE_NAME)
  else process.env[PROBE_NAME] = originalProbe
  vi.resetModules()
  for (const fixtureRoot of roots.splice(0)) rmSync(fixtureRoot, { recursive: true, force: true })
})

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function buildFixture(environment: Record<string, string>): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'arx-client-build-'))
  roots.push(fixtureRoot)
  write(join(fixtureRoot, 'apps/web/dist/index.html'), '<main></main>')
  write(join(fixtureRoot, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(fixtureRoot, environment)
  return fixtureRoot
}

describe('client build environment', () => {
  it('requires an exact public environment for a named artifact profile', () => {
    const expected = {
      ARX_CLIENT_BUILD_PROFILE: 'official',
      ARX_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      ARX_CLIENT_TITLE: 'arx Harness',
    } as const

    expect(() => { assertClientBuildEnvironment({ PATH: '/bin', ...expected }, expected) }).not.toThrow()
    expect(() => { assertClientBuildEnvironment({}, expected) }).toThrow(/ARX_CLIENT_TITLE/)
    expect(() => { assertClientBuildEnvironment({ ARX_CLIENT_TITLE: 'Other' }, expected) }).toThrow(/ARX_CLIENT_TITLE/)
    expect(() => {
      assertClientBuildEnvironment({ ...expected, ARX_CLIENT_UNDECLARED: 'value' }, expected)
    }).toThrow(/ARX_CLIENT_UNDECLARED/)
  })

  it('inherits public values by default and isolates an explicit official profile', () => {
    const parent = {
      PATH: '/bin',
      ARX_BUILD_CLIENT_PROFILE: 'official',
      ARX_CLIENT_BUILD_PROFILE: 'local',
      ARX_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      ARX_CLIENT_TITLE: 'Local title',
      ARX_CLIENT_EXTRA: 'local-extra',
    }

    expect(resolveClientBuildEnvironment({ ARX_CLIENT_TITLE: 'Local title' })).toEqual({
      ARX_CLIENT_TITLE: 'Local title',
    })
    expect(resolveClientBuildEnvironment(parent)).toEqual({
      ARX_CLIENT_BUILD_PROFILE: 'official',
      ARX_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      ARX_CLIENT_TITLE: 'arx Harness',
    })
    expect(() => {
      resolveClientBuildEnvironment({ ARX_BUILD_CLIENT_PROFILE: 'official' })
    }).toThrow(/ARX_CLIENT_COMMIT_HASH/)
    expect(() => { resolveClientBuildEnvironment({}, 'unknown') }).toThrow(/unknown client build profile/)
    expect(clientBuildProcessEnvironment(parent, {
      ARX_CLIENT_BUILD_PROFILE: 'official',
      ARX_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      ARX_CLIENT_TITLE: 'arx Harness',
    })).toEqual({
      PATH: '/bin',
      ARX_CLIENT_BUILD_PROFILE: 'official',
      ARX_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      ARX_CLIENT_TITLE: 'arx Harness',
    })
    expect(repositoryCommitHash('/unused', { ARX_CLIENT_COMMIT_HASH: COMMIT_HASH })).toBe(COMMIT_HASH.slice(0, 7))
  })

  it('defines only public client values over a non-enumerable fallback', () => {
    expect(clientBuildEnvironmentDefines({
      PATH: '/bin',
      ARX_TEST_API_KEY: 'secret',
      ARX_CLIENT_VARIANT: 'quoted "value"',
      ARX_CLIENT_EMPTY: '',
      ARX_CLIENT_UNSET: undefined,
    })).toEqual({
      'process.env': '{}',
      'process.env.ARX_CLIENT_EMPTY': '""',
      'process.env.ARX_CLIENT_VARIANT': '"quoted \\"value\\""',
    })
  })

  it('feeds the same build-process value to dynamic tsdown bundles and the Vite shell', async () => {
    process.env[PROBE_NAME] = 'shared-value'

    const configs = clientBundle('@arx-ai/arx-client-ui-sidebar', [
      'lib/types/index.js',
      'lib/types/invariant.js',
    ])({ env: { ARX_BUILD_FACE: 'client' } })
    if (!Array.isArray(configs)) throw new TypeError('client bundle config must be an array')
    const dynamic = configs.find(config => config.name === '@arx-ai/arx-client-ui-sidebar/client')
    expect(dynamic?.define).toMatchObject({
      'process.env': '{}',
      [PROBE_KEY]: '"shared-value"',
    })

    const viteConfigPath = '../apps/web/vite.config.ts'
    const viteModule: unknown = await import(viteConfigPath)
    if (typeof viteModule !== 'object' || viteModule === null) {
      throw new TypeError('web Vite config module must be an object')
    }
    const viteConfig: unknown = Reflect.get(viteModule, 'default')
    if (typeof viteConfig === 'function') throw new TypeError('web Vite config must be an object')
    if (typeof viteConfig !== 'object' || viteConfig === null) {
      throw new TypeError('web Vite config must be an object')
    }
    expect(Reflect.get(viteConfig, 'define')).toMatchObject({
      'process.env': '{}',
      [PROBE_KEY]: '"shared-value"',
    })
  })

  it('binds the recorded environment to a complete set of client artifacts', () => {
    const officialEnvironment = {
      ARX_CLIENT_BUILD_PROFILE: 'official',
      ARX_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      ARX_CLIENT_TITLE: 'arx Harness',
    }
    const official = buildFixture(officialEnvironment)
    const defaultBuild = buildFixture({})

    expect(readClientBuildRecord(official, officialEnvironment).environment).toEqual(officialEnvironment)
    expect(() => { readClientBuildRecord(defaultBuild, officialEnvironment) }).toThrow(/ARX_CLIENT_/)
    expect(() => { readClientBuildRecord(join(defaultBuild, 'missing')) }).toThrow(/record.*missing/)

    write(join(official, 'apps/web/dist/index.html'), '<main>changed</main>')
    expect(() => { readClientBuildRecord(official) }).toThrow(/artifacts differ/)
  })

  it('keeps public client values out of workflow-wide environments', () => {
    for (const name of arxBuildWorkflows) {
      const path = `.github/workflows/${name}`
      const document: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
      if (typeof document !== 'object' || document === null || Array.isArray(document)) {
        throw new TypeError(`${path} must contain a workflow object`)
      }
      expect(JSON.stringify(document), path).not.toContain('ARX_CLIENT_')
    }
  })
})
