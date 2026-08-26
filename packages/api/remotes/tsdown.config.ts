import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@arx-ai/arx-api-remotes',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)
