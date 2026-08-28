/** The catalog constraints the serialized settings schema cannot express. */
import { describe, expect, it } from 'vitest'
import {
  formatCapacity, modelDrafts, parseCapacity, validateModelDrafts,
} from '../src/client/model-catalog.ts'

describe('modelDrafts', () => {
  it('keeps every record and substitutes an empty row for anything else', () => {
    // A hand-written `settings.yaml` can put a scalar, a null, or a nested
    // array where the schema expects a record; the card renders a blank row
    // rather than inventing catalog values for it.
    expect(modelDrafts([{ id: 'a', hidden: 1 }, 'text', null, ['x'], 7]))
      .toEqual([{ id: 'a', hidden: 1 }, {}, {}, {}, {}])
  })

  it('reads a non-array value as no rows at all', () => {
    expect(modelDrafts(undefined)).toEqual([])
    expect(modelDrafts({ id: 'a' })).toEqual([])
  })
})

describe('validateModelDrafts', () => {
  it('accepts an inherited catalog, which the user layer does not own', () => {
    expect(validateModelDrafts(undefined)).toBeUndefined()
  })

  it('names the first row whose id is missing, blank, or not a string', () => {
    expect(validateModelDrafts([{}])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateModelDrafts([{ id: '   ' }])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateModelDrafts([{ id: 42 }])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateModelDrafts([{ id: 'ok' }, { id: '' }])).toEqual({ index: 1, key: 'modelIdRequired' })
  })

  it('compares ids trimmed, so a padded paste cannot pass as a second model', () => {
    expect(validateModelDrafts([{ id: 'same' }, { id: 'same' }]))
      .toEqual({ index: 1, key: 'modelIdDuplicate' })
    expect(validateModelDrafts([{ id: 'model' }, { id: 'model ' }]))
      .toEqual({ index: 1, key: 'modelIdDuplicate' })
  })

  it('accepts an absent name and refuses an empty or non-string one', () => {
    expect(validateModelDrafts([{ id: 'm' }])).toBeUndefined()
    expect(validateModelDrafts([{ id: 'm', name: '' }])).toEqual({ index: 0, key: 'modelNameInvalid' })
    expect(validateModelDrafts([{ id: 'm', name: 7 }])).toEqual({ index: 0, key: 'modelNameInvalid' })
  })

  it('requires each capacity, when present, to be a positive whole count', () => {
    for (const [field, key] of [
      ['contextWindow', 'modelContextInvalid'],
      ['maxTokens', 'modelMaxTokensInvalid'],
    ] as const) {
      expect(validateModelDrafts([{ id: 'm', [field]: null }])).toEqual({ index: 0, key })
      expect(validateModelDrafts([{ id: 'm', [field]: 1.5 }])).toEqual({ index: 0, key })
      expect(validateModelDrafts([{ id: 'm', [field]: 0 }])).toEqual({ index: 0, key })
      expect(validateModelDrafts([{ id: 'm', [field]: 1 }])).toBeUndefined()
    }
  })
})

describe('capacity spelling', () => {
  it('reads counts written plainly, in thousands, or in millions', () => {
    expect(parseCapacity('')).toBeUndefined()
    expect(parseCapacity('  ')).toBeUndefined()
    expect(parseCapacity('128000')).toBe(128_000)
    expect(parseCapacity('256k')).toBe(256_000)
    expect(parseCapacity('1M')).toBe(1_000_000)
    // A decimal multiple is exact in intent but not in binary floating point.
    expect(parseCapacity('2.3M')).toBe(2_300_000)
    expect(parseCapacity('nonsense')).toBeNaN()
  })

  it('spells a stored count back in the shortest form that round-trips', () => {
    expect(formatCapacity(1_000_000)).toBe('1M')
    expect(formatCapacity(256_000)).toBe('256K')
    expect(formatCapacity(128_500)).toBe('128500')
    // Not a whole positive count, so there is no suffixed spelling to offer.
    expect(formatCapacity(1.5)).toBe('1.5')
    expect(formatCapacity(0)).toBe('0')
  })

  it('round-trips every spelling it produces', () => {
    for (const value of [1, 999, 1_000, 128_000, 256_000, 1_000_000, 2_300_000]) {
      expect(parseCapacity(formatCapacity(value))).toBe(value)
    }
  })
})
