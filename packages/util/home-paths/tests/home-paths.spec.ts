import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ARX_HOME_DISPLAY,
  ARX_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultArxHome,
  arxHomeDisplay,
  arxHomePath,
  expandHomePath,
  resolveArxHome,
} from '@arx-ai/arx-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('arx path helpers', () => {
  it('owns the shared default ARX home directory name', () => {
    expect(ARX_HOME_DIR_NAME).toBe('.arx')
    expect(DEFAULT_ARX_HOME_DISPLAY).toBe('~/.arx')
    expect(defaultArxHome()).toBe(join(homedir(), '.arx'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.arx')).toBe(join(homedir(), '.arx'))
    expect(expandHomePath('~\\.arx')).toBe(join(homedir(), '.arx'))
    expect(expandHomePath('/tmp/.arx')).toBe('/tmp/.arx')
    expect(expandHomePath('~other/.arx')).toBe('~other/.arx')
  })

  it('resolves explicit path before ARX_HOME and the default', () => {
    const envHome = join(homedir(), 'env-arx')

    expect(resolveArxHome('/tmp/explicit-arx', { ARX_HOME: '~/env-arx' })).toBe(resolve('/tmp/explicit-arx'))
    expect(resolveArxHome(undefined, { ARX_HOME: '~/env-arx' })).toBe(envHome)
    expect(resolveArxHome(undefined, {})).toBe(defaultArxHome())
  })

  it('treats an empty or whitespace-only ARX_HOME as unset', () => {
    expect(resolveArxHome(undefined, { ARX_HOME: '' })).toBe(defaultArxHome())
    expect(resolveArxHome(undefined, { ARX_HOME: '   ' })).toBe(defaultArxHome())
  })

  it('joins child segments onto the resolved ARX_HOME', () => {
    vi.stubEnv('ARX_HOME', '~/env-arx')
    expect(arxHomePath()).toBe(join(homedir(), 'env-arx'))
    expect(arxHomePath('storages', 'cache')).toBe(join(homedir(), 'env-arx', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(arxHomeDisplay(resolve(defaultArxHome()))).toBe('~/.arx')
    expect(arxHomeDisplay('/some/other/root')).toBe('$ARX_HOME')
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arx-watch-path-'))
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
