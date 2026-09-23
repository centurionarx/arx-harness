/**
 * The one-time copy of the pre-rename harness home: when it runs, what it
 * carries, what it refuses to touch, and how it reports both a copy it just
 * made and one a previous boot made.
 */

import { mkdtempSync } from 'node:fs'
import { lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HOME_MIGRATION_MARKER,
  migrateLegacyHome,
  readHomeMigrationMarker,
  type HomeMigrationReport,
} from '../src/home-migration.ts'

const BIN = 'arx-test-bin'
const AT = new Date('2026-09-22T10:00:00.000Z')

const tmp = (): string => mkdtempSync(join(tmpdir(), 'arx-home-migration-'))

/** A run whose homes are named explicitly, with the notices it emitted. */
function run(legacy: string | undefined, current: string): {
  migrate: () => Promise<HomeMigrationReport | undefined>
  notices: string[]
} {
  const notices: string[] = []
  const env = { ARX_HOME: current, ...legacy === undefined ? {} : { CXH_HOME: legacy } }
  return {
    notices,
    migrate: () => migrateLegacyHome(BIN, {
      env,
      warn: line => void notices.push(line),
      appVersion: '1.0.10',
      now: () => AT,
    }),
  }
}

/** Seed a legacy home with one file of each kind the harness keeps there. */
async function seedLegacy(root: string): Promise<void> {
  await mkdir(join(root, 'profiles', 'web'), { recursive: true })
  await mkdir(join(root, 'sessions'), { recursive: true })
  await writeFile(join(root, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: x\n', 'utf8')
  await writeFile(join(root, '.credentials.yaml'), 'EXA_API_KEY: secret\n', 'utf8')
  await writeFile(join(root, 'profiles', 'web', 'cordis.patch.yml'), '- id: llm-agent-cli\n', 'utf8')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('legacy harness home migration', () => {
  it('copies the legacy tree and publishes it with a marker', async () => {
    const legacy = join(tmp(), 'legacy')
    const current = join(tmp(), 'current')
    await seedLegacy(legacy)
    const { migrate, notices } = run(legacy, current)

    const report = await migrate()

    expect(report).toEqual({
      fromDisplay: '$CXH_HOME',
      toDisplay: '$ARX_HOME',
      at: AT.toISOString(),
      appVersion: '1.0.10',
    })
    expect(await readFile(join(current, 'settings.yaml'), 'utf8')).toContain('welcomeNoticeVersion')
    expect(await readFile(join(current, '.credentials.yaml'), 'utf8')).toContain('EXA_API_KEY')
    expect(await readFile(join(current, 'profiles', 'web', 'cordis.patch.yml'), 'utf8')).toContain('llm-agent-cli')
    expect(await readHomeMigrationMarker(current)).toEqual(report)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('$CXH_HOME')
    expect(notices[0]).toContain('left untouched')
  })

  it('carries an empty directory and keeps a symlink a symlink', async () => {
    const legacy = join(tmp(), 'legacy')
    const current = join(tmp(), 'current')
    await mkdir(join(legacy, 'storages'), { recursive: true })
    await mkdir(join(legacy, 'profiles', 'node_modules'), { recursive: true })
    await writeFile(join(legacy, 'target.json'), '{}', 'utf8')
    await symlink(join(legacy, 'target.json'), join(legacy, 'profiles', 'node_modules', 'link.json'))

    await run(legacy, current).migrate()

    expect(await readdir(join(current, 'storages'))).toEqual([])
    const link = await lstat(join(current, 'profiles', 'node_modules', 'link.json'))
    expect(link.isSymbolicLink()).toBe(true)
  })

  it('leaves the legacy home untouched', async () => {
    const legacy = join(tmp(), 'legacy')
    const current = join(tmp(), 'current')
    await seedLegacy(legacy)
    const before = (await readdir(legacy)).sort()

    await run(legacy, current).migrate()

    expect((await readdir(legacy)).sort()).toEqual(before)
    expect(await readFile(join(legacy, 'settings.yaml'), 'utf8')).toContain('welcomeNoticeVersion')
  })

  it('copies once and reports the same migration on every later boot', async () => {
    const legacy = join(tmp(), 'legacy')
    const current = join(tmp(), 'current')
    await seedLegacy(legacy)
    const first = run(legacy, current)
    const report = await first.migrate()

    await writeFile(join(current, 'settings.yaml'), 'edited: true\n', 'utf8')
    const second = run(legacy, current)
    const again = await second.migrate()

    expect(again).toEqual(report)
    expect(second.notices).toEqual([])
    expect(await readFile(join(current, 'settings.yaml'), 'utf8')).toBe('edited: true\n')
  })

  it('copies nothing into a home the user already made', async () => {
    const legacy = join(tmp(), 'legacy')
    const current = join(tmp(), 'current')
    await seedLegacy(legacy)
    await mkdir(current, { recursive: true })
    const { migrate, notices } = run(legacy, current)

    expect(await migrate()).toBeUndefined()
    expect(await readdir(current)).toEqual([])
    expect(notices).toEqual([])
  })

  it('does nothing when the legacy home is absent', async () => {
    const current = join(tmp(), 'current')
    const { migrate, notices } = run(join(tmp(), 'never-written'), current)

    expect(await migrate()).toBeUndefined()
    expect(notices).toEqual([])
  })

  it('does nothing when both names resolve to one directory', async () => {
    const same = join(tmp(), 'same')
    await seedLegacy(same)
    expect(await run(same, same).migrate()).toBeUndefined()
  })

  it('refuses to copy a home onto itself even before either exists', async () => {
    const same = join(tmp(), 'never-written')
    expect(await run(same, same).migrate()).toBeUndefined()
  })

  it('reads the process environment and the wall clock when given neither', async () => {
    const legacy = join(tmp(), 'legacy')
    const current = join(tmp(), 'current')
    await seedLegacy(legacy)
    vi.stubEnv('CXH_HOME', legacy)
    vi.stubEnv('ARX_HOME', current)
    const before = Date.now()

    const report = await migrateLegacyHome(BIN, { warn: () => {}, appVersion: '1.0.10' })

    expect(report?.fromDisplay).toBe('$CXH_HOME')
    expect(Date.parse(report?.at ?? '')).toBeGreaterThanOrEqual(before)
    expect(await readFile(join(current, 'settings.yaml'), 'utf8')).toContain('welcomeNoticeVersion')
  })

  it('removes staging a previous interrupted run left behind', async () => {
    const legacy = join(tmp(), 'legacy')
    const root = tmp()
    const current = join(root, '.arx')
    await seedLegacy(legacy)
    const stale = join(root, '.arx.migrating-old')
    await mkdir(stale, { recursive: true })
    await writeFile(join(stale, 'half-copied.yaml'), 'partial\n', 'utf8')

    await run(legacy, current).migrate()

    expect(await readdir(root)).toEqual(['.arx'])
  })

  it('keeps a sibling directory that is not this module staging', async () => {
    const legacy = join(tmp(), 'legacy')
    const root = tmp()
    const current = join(root, '.arx')
    await seedLegacy(legacy)
    await mkdir(join(root, '.arx-backup'), { recursive: true })

    await run(legacy, current).migrate()

    expect((await readdir(root)).sort()).toEqual(['.arx', '.arx-backup'])
  })

  it('fails loud naming the escape when the copy cannot complete', async () => {
    const root = tmp()
    const current = join(root, '.arx')
    // A legacy home that is a regular file: present, so the copy is attempted,
    // and refused by `cp` because a file cannot become the staged directory.
    const legacy = join(tmp(), 'legacy')
    await writeFile(legacy, 'not a home\n', 'utf8')

    await expect(run(legacy, current).migrate()).rejects.toThrow(/could not copy \$CXH_HOME to \$ARX_HOME/)
    // The destination never appeared and no staging survived the failure.
    expect(await readdir(root)).toEqual([])
  })

  it('fails loud when staging cannot be prepared', async () => {
    const legacy = join(tmp(), 'legacy')
    await seedLegacy(legacy)
    const current = join(tmp(), 'missing-parent', '.arx')

    await expect(run(legacy, current).migrate())
      .rejects.toThrow(/could not prepare a copy of \$CXH_HOME beside \$ARX_HOME/)
  })

  it('names the default homes symbolically when no override is set', async () => {
    const home = tmp()
    // `os.homedir()` reads these per call, so both defaults land under a
    // temporary directory without either name being configured.
    vi.stubEnv('HOME', home)
    vi.stubEnv('USERPROFILE', home)
    const legacy = join(home, '.cxh')
    await seedLegacy(legacy)
    const notices: string[] = []

    const report = await migrateLegacyHome(BIN, {
      env: {},
      warn: line => void notices.push(line),
      appVersion: '1.0.10',
      now: () => AT,
    })

    expect(report?.fromDisplay).toBe('~/.cxh')
    expect(report?.toDisplay).toBe('~/.arx')
  })
})

describe('the migration marker', () => {
  it('is absent for a home nothing migrated into', async () => {
    expect(await readHomeMigrationMarker(tmp())).toBeUndefined()
  })

  it('is absent when the file holds no JSON', async () => {
    const home = tmp()
    await writeFile(join(home, HOME_MIGRATION_MARKER), 'not json', 'utf8')
    expect(await readHomeMigrationMarker(home)).toBeUndefined()
  })

  it('is absent when the JSON is not a migration report', async () => {
    const home = tmp()
    for (const content of ['null', '[]', '{"fromDisplay":1}', '{"fromDisplay":"~/.cxh"}']) {
      await writeFile(join(home, HOME_MIGRATION_MARKER), content, 'utf8')
      expect(await readHomeMigrationMarker(home)).toBeUndefined()
    }
  })
})
