import { clientLibrary } from '../../client/tsdown.client.ts'

export default clientLibrary(
  '@arx-ai/arx-client-test-runtime',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
