import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@centurionarx/cxh-client-modules',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
