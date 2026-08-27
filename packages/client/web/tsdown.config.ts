import { staticLinked } from '../tsdown.client.ts'

export default staticLinked(
  '@arx-ai/arx-client-web',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
