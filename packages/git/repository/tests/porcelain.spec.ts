import { describe, expect, it } from 'vitest'
import { parsePorcelain } from '../src/porcelain.ts'

const tracked = (xy: string, submodule = 'N...', path = 'dir/file.txt') =>
  `1 ${xy} ${submodule} 100644 100644 100644 a b ${path}\0`

describe('complete porcelain-v2 records', () => {
  it('accepts empty output and ignores headers it does not consume', () => {
    const empty = { status: { staged: [], unstaged: [], untracked: [], unmerged: [] },
      branch: null, head: null, aheadBehind: null }
    expect(parsePorcelain('', 1)).toEqual(empty)
    expect(parsePorcelain('# branch.upstream origin/main\0', 1)).toEqual(empty)
  })


  it('retains tab, newline, Unicode and pathspec syntax as literal wire paths', () => {
    const paths = ['- odd\tname\náéç.txt', ':(glob)*']
    const text = paths.map(path => '? ' + path + '\0').join('')
    expect(parsePorcelain(text, 2).status.untracked.map(entry => entry.path)).toEqual(paths)
  })

  it('counts a dual-side entry once and retains all submodule fields', () => {
    const entry = { path: 'dir/file.txt', xy: 'MM', submodule: 'SCMU' }
    expect(parsePorcelain(tracked('MM', 'SCMU'), 1).status).toEqual({
      staged: [entry], unstaged: [entry], untracked: [], unmerged: [],
    })
    expect(parsePorcelain(tracked('..'), 1).status).toEqual({ staged: [], unstaged: [], untracked: [], unmerged: [] })
    expect(() => parsePorcelain('? one\0? two\0', 1)).toThrow('REPOSITORY_ITEM_LIMIT')
  })

  it.each([
    '# branch.oid not-a-hash\0', '# branch.ab nonsense\0',
    '# branch.ab +9007199254740992 -0\0', '# branch.ab +0 -9007199254740992\0',
    '? \0', '1 M. N...\0', tracked('ZZ'), tracked('M.', 'bad'), tracked('M.', 'N...', ''),
  ])('refuses malformed or unrepresentable output %j', (text) => {
    expect(() => parsePorcelain(text, 10)).toThrow('REPOSITORY_INVALID_STATUS')
  })
})
