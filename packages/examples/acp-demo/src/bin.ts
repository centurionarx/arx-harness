#!/usr/bin/env node
/**
 * Boot an ACP stdio server from `cordis.yml`; usage is
 * `arx-acp-demo [--config path]`, defaulting to `./cordis.yml`. Shared env
 * loading, Loader guards, snapshot config selection, and settled-tree boot live
 * in arx-app-boot. Replay skips `.env` and selects sibling
 * `cordis.snapshot.yml` so a stray key cannot trigger a model call. EOF disposes
 * and flushes snapshot runs; the calling automation owns process lifetime. Stdout is
 * reserved for JSON-RPC, so diagnostics go only to stderr.
 * @module @arx-ai/arx-acp-demo/bin
 */

import { parseArgs } from 'node:util'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@arx-ai/arx-app-boot'

const NAME = 'arx-acp-demo'

/* v8 ignore start -- thin self-executing composition over the unit-tested
   arx-app-boot helpers; exercised end-to-end by the snapshot suite and the
   built-bin smoke */
installFailLoud(NAME)
const snapshotMode = process.env['ARX_SNAPSHOT']
if (snapshotMode !== 'replay') loadEnv(NAME)
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { config: { type: 'string', short: 'c' } },
  strict: true,
})
const ctx = await boot(NAME, resolveConfigPath(values.config ?? './cordis.yml', snapshotMode))
if (snapshotMode !== undefined) {
  process.stdin.on('end', () => {
    void ctx.fiber.dispose().then(() => { process.exit(0) })
  })
}
/* v8 ignore stop */
