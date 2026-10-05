import { describe, expect, it } from 'vitest'
import { builtDeclarationPath } from './doc-typecheck-paths.ts'

describe('builtDeclarationPath', () => {
  it('maps package source directories and exact entry files to built declarations', () => {
    expect(builtDeclarationPath('./packages/*/*/src')).toBe('./packages/*/*/lib/types')
    expect(builtDeclarationPath('./packages/host/apiproxy/src/*'))
      .toBe('./packages/host/apiproxy/lib/types/*')
    expect(builtDeclarationPath('./packages/client/runtime/src/client'))
      .toBe('./packages/client/runtime/lib/types/client')
    expect(builtDeclarationPath('./packages/runtime-diagnostics/invariants/src/index.ts'))
      .toBe('./packages/runtime-diagnostics/invariants/lib/types/index.d.ts')
    expect(builtDeclarationPath('./packages/core/session/src/invariant.ts'))
      .toBe('./packages/core/session/lib/types/invariant.d.ts')
  })

  it.each(['github', 'repository'])('preserves generated %s Remote declaration aliases', (name) => {
    const target = `./packages/git/${name}/lib/typert.remote-client.d.ts`
    expect(builtDeclarationPath(target)).toBe(target)
  })

  it.each([
    './packages/git/github/lib/typert.remote-client.js',
    './packages/git/github/declarations/typert.remote-client.d.ts',
  ])('rejects aliases outside supported source and declaration output: %s', (target) => {
    expect(() => builtDeclarationPath(target)).toThrow('cannot map workspace source path')
  })

  it('rejects aliases without a supported source target', () => {
    expect(() => builtDeclarationPath('./packages/runtime-diagnostics/invariants/source/index.ts'))
      .toThrow('cannot map workspace source path')
  })
})
