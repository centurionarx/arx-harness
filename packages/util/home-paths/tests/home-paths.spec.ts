import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CXH_HOME_DISPLAY,
  CXH_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultDshHome,
  cxhHomeDisplay,
  cxhHomePath,
  expandHomePath,
  resolveDshHome,
} from '@centurionarx/cxh-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('cxh path helpers', () => {
  it('owns the shared default CXH home directory name', () => {
    expect(CXH_HOME_DIR_NAME).toBe('.cxh')
    expect(DEFAULT_CXH_HOME_DISPLAY).toBe('~/.cxh')
    expect(defaultDshHome()).toBe(join(homedir(), '.cxh'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.cxh')).toBe(join(homedir(), '.cxh'))
    expect(expandHomePath('~\\.cxh')).toBe(join(homedir(), '.cxh'))
    expect(expandHomePath('/tmp/.cxh')).toBe('/tmp/.cxh')
    expect(expandHomePath('~other/.cxh')).toBe('~other/.cxh')
  })

  it('resolves explicit path before CXH_HOME and the default', () => {
    const envHome = join(homedir(), 'env-cxh')

    expect(resolveDshHome('/tmp/explicit-cxh', { CXH_HOME: '~/env-cxh' })).toBe(resolve('/tmp/explicit-cxh'))
    expect(resolveDshHome(undefined, { CXH_HOME: '~/env-cxh' })).toBe(envHome)
    expect(resolveDshHome(undefined, {})).toBe(defaultDshHome())
  })

  it('treats an empty or whitespace-only CXH_HOME as unset', () => {
    expect(resolveDshHome(undefined, { CXH_HOME: '' })).toBe(defaultDshHome())
    expect(resolveDshHome(undefined, { CXH_HOME: '   ' })).toBe(defaultDshHome())
  })

  it('joins child segments onto the resolved CXH_HOME', () => {
    vi.stubEnv('CXH_HOME', '~/env-cxh')
    expect(cxhHomePath()).toBe(join(homedir(), 'env-cxh'))
    expect(cxhHomePath('storages', 'cache')).toBe(join(homedir(), 'env-cxh', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(cxhHomeDisplay(resolve(defaultDshHome()))).toBe('~/.cxh')
    expect(cxhHomeDisplay('/some/other/root')).toBe('$CXH_HOME')
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cxh-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
