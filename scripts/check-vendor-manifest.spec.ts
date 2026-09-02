import { describe, expect, it } from 'vitest'

import { classifyVendorManifest } from './check-vendor-manifest.ts'

describe('classifyVendorManifest', () => {
  it('flags vendored source and vendored bin.js without the manifest', () => {
    const classified = classifyVendorManifest([
      'packages/x/src/index.ts',
      'vendor/cordis/src/index.ts',
      'vendor/cordis/bin.js',
      'vendor/cordis/package.json',
      'vendor/cordis/src/deep/nested.ts',
    ])
    expect(classified.vendored).toEqual([
      'vendor/cordis/src/index.ts',
      'vendor/cordis/bin.js',
      'vendor/cordis/src/deep/nested.ts',
    ])
    expect(classified.manifest).toBe(false)
  })

  it('treats manifest and non-source vendor edits as outside the vendored-source guard', () => {
    const classified = classifyVendorManifest([
      'vendor/cordis/README.md',
      'vendor/README.md',
      'apps/vendor/src/file.ts',
      'lib/vendor/x.js',
    ])
    expect(classified.vendored).toEqual([])
    expect(classified.manifest).toBe(true)
  })
})
