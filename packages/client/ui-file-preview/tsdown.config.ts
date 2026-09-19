import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'
const require = createRequire(import.meta.url)
const bundle = clientBundle('@arx-ai/arx-client-ui-file-preview', ['lib/types/index.js', 'lib/types/invariant.js'])
export default ((options: Parameters<typeof bundle>[0]) => bundle(options).map((config): UserConfig => config.platform !== 'browser' ? config : {
  ...config,
  outputOptions: async (output, format, context) => {
    const inherited = typeof config.outputOptions === 'function'
      ? await config.outputOptions(output, format, context) : config.outputOptions
    return { ...output, ...inherited, codeSplitting: false }
  },
  plugins: [{
    name: 'arx-preview-pdf-worker-source',
    resolveId(source: string) { return source === 'pdfjs-dist/build/pdf.worker.min.mjs?raw' ? '\0arx-preview-pdf-worker' : null },
    load(id: string) {
      if (id !== '\0arx-preview-pdf-worker') return null
      return 'export default ' + JSON.stringify(readFileSync(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'), 'utf8'))
    },
  }, ...(config.plugins ?? [])],
}))
