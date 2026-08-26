import { clientLibrary } from '../../client/tsdown.client.ts'

export default clientLibrary(
  '@centurionarx/cxh-client-test-runtime',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
