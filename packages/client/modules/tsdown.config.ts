import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@arx-ai/arx-client-modules',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
