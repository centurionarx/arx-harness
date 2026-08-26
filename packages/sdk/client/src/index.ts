/**
 * TypeScript client SDK for the CENTURIONarx Harness runtime: spawn the
 * `cxh-jsonrpc-agent` runtime as a subprocess and drive agent turns over
 * stdio JSON-RPC. `CENTURIONarxHarness` is the high-level run API;
 * `HarnessClient` is the lower-level protocol client. A pure library — it
 * registers nothing on a Cordis context; the runtime process it spawns is a
 * complete harness configured by its own `cordis.yml`.
 *
 * @module @centurionarx/cxh-sdk-client
 */

export { CENTURIONarxHarness, HarnessSession } from './api.ts'
export type { RunOptions } from './api.ts'
export {
  HarnessClient,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
} from './client.ts'
export type { NotificationSubscription } from './client.ts'
export { JsonRpcResponseError } from '@centurionarx/cxh-sdk-protocol'
export type {
  ContentBlock,
  CENTURIONarxHarnessOptions,
  HarnessClientOptions,
  HarnessNotification,
  NotificationFilter,
  RunResult,
} from './types.ts'
