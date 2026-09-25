import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@arx-ai/cordis'
import { lookupIndexedSkill } from '../src/indexed.ts'

const indexRead = vi.hoisted(() => ({ path: '', calls: 0 }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    async readFile(path: string, options?: { signal?: AbortSignal }) {
      if (path === indexRead.path) {
        indexRead.calls += 1
        // A different writer can extend the file after stat; the first TSV row is still valid.
        return Buffer.from('dormant-skill\t-\tIndexed\n' + 'x'.repeat(2 * 1024 * 1024 + 1))
      }
      return await real.readFile(path, options)
    },
  }
})

afterEach(() => {
  indexRead.path = ''
  indexRead.calls = 0
})

it('refuses an index that grows beyond the byte limit after its stat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arx-index-read-race-'))
  const index = join(root, 'catalogo', 'indice-skills.tsv')
  const skill = join(root, 'dormant-skill', 'SKILL.md')
  try {
    await mkdir(join(root, 'catalogo'))
    await mkdir(join(root, 'dormant-skill'))
    await writeFile(index, 'dormant-skill\t-\tIndexed\n')
    await writeFile(skill, '---\nname: dormant-skill\ndescription: Indexed\n---\n\nBody.\n')
    indexRead.path = index
    expect(await lookupIndexedSkill(new Context(), root, 'dormant-skill')).toBeUndefined()
    expect(indexRead.calls).toBe(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
