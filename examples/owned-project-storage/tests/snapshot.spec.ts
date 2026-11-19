import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { ownedStorageScenario } from '../scenario.ts'
it('preserves owner isolation and durable tombstones across an old synthetic backup restore through Loader', async () => {
  const actual = await ownedStorageScenario()
  const expected = await readFile(new URL('../snapshot.expected.md', import.meta.url), 'utf8')
  expect(actual).toBe(expected)
}, 60000)
