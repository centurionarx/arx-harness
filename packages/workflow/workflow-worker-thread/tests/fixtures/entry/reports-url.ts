/** Worker entry that posts the URL an imported module read, then exits. */
import { parentPort } from 'node:worker_threads'
import { url } from './url.ts'

parentPort?.postMessage(url)
