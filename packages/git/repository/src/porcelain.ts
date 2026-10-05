/** Strict decoding of complete Git porcelain-v2 NUL records. */
import type { RepositoryEntry, RepositoryStatus } from './types.ts'

/** Decoded status with branch headers used by inspect. */
export interface Porcelain {
  status: RepositoryStatus
  branch: string | null
  head: string | null
  aheadBehind: { ahead: number; behind: number } | null
}

/**
 * Decode complete UTF-8 porcelain-v2 output, including the extra NUL rename path.
 * @param text - Untruncated Git output.
 * @param maxItems - Maximum total records, counting a dual-side path once.
 * @returns Independent status groups and branch identity.
 */
export function parsePorcelain(text: string, maxItems: number): Porcelain {
  if (text !== '' && !text.endsWith('\0')) throw new Error('REPOSITORY_INVALID_STATUS')
  const records = text.split('\0')
  records.pop()
  const result: Porcelain = {
    status: { staged: [], unstaged: [], untracked: [], unmerged: [] }, branch: null, head: null, aheadBehind: null,
  }
  let items = 0
  for (let index = 0; index < records.length; index++) {
    const record = records[index] ?? ''
    if (record.startsWith('# ')) {
      if (record.startsWith('# branch.oid ')) {
        const value = record.slice(13)
        if (value !== '(initial)' && !/^[a-f0-9]{40,64}$/.test(value)) throw new Error('REPOSITORY_INVALID_STATUS')
        result.head = value === '(initial)' ? null : value
      } else if (record.startsWith('# branch.head ')) {
        const value = record.slice(14)
        result.branch = value === '(detached)' ? null : value
      } else if (record.startsWith('# branch.ab ')) {
        const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record)
        if (!match) throw new Error('REPOSITORY_INVALID_STATUS')
        const ahead = Number(match[1]), behind = Number(match[2])
        if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind)) throw new Error('REPOSITORY_INVALID_STATUS')
        result.aheadBehind = { ahead, behind }
      }
      continue
    }
    if (++items > maxItems) throw new Error('REPOSITORY_ITEM_LIMIT')
    if (record.startsWith('? ')) {
      if (record.length === 2) throw new Error('REPOSITORY_INVALID_STATUS')
      result.status.untracked.push({ path: record.slice(2), xy: '??', submodule: 'N...' })
      continue
    }
    const tag = record[0]
    const fields = tag === '1' ? 8 : tag === '2' ? 9 : tag === 'u' ? 10 : 0
    if (!fields) throw new Error('REPOSITORY_INVALID_STATUS')
    let cursor = 0
    const tokens: string[] = []
    for (let field = 0; field < fields; field++) {
      const end = record.indexOf(' ', cursor)
      if (end < 0) throw new Error('REPOSITORY_INVALID_STATUS')
      tokens.push(record.slice(cursor, end))
      cursor = end + 1
    }
    const xy = tokens[1] ?? '', submodule = tokens[2] ?? '', path = record.slice(cursor)
    if (!/^[.MADRCUT]{2}$/.test(xy) || !/^(N\.\.\.|S[.C][.M][.U])$/.test(submodule) || !path) throw new Error('REPOSITORY_INVALID_STATUS')
    const entry: RepositoryEntry = { path, xy, submodule }
    if (tag === '2') {
      const originalPath = records[++index]
      if (!originalPath) throw new Error('REPOSITORY_INVALID_STATUS')
      entry.originalPath = originalPath
    }
    if (tag === 'u') result.status.unmerged.push(entry)
    else {
      if (xy[0] !== '.') result.status.staged.push(entry)
      if (xy[1] !== '.') result.status.unstaged.push(entry)
    }
  }
  return result
}
