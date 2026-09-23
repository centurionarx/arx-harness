/**
 * Host-native OS integration library: the shared no-shell `execFile` runner
 * (utf8 stdio capture, abort propagation, Windows console hide) and the path
 * openers built on it (the operating system's default application, the
 * default browser for documents a browser renders, and the text editor). A
 * library, not a plugin — no ctx, no state, no events.
 * @module @arx-ai/arx-native-command
 */

export { runNativeCommand, type NativeCommandRunner } from './runner.ts'
export {
  canOpenNativePath, openNativePath, openNativeTextFile,
  type PathOpenerInternals, type PathOpenerRunner,
} from './path-opener.ts'
