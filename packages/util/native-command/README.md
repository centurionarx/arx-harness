# arx-native-command

A **zero-dependency no-shell `execFile` runner** shared by host-native OS integrations: one `runNativeCommand(command, args, signal)` call spawns the executable directly (never a shell string), captures utf8 stdout/stderr, propagates the caller's abort into child termination, and hides the transient console window on Windows. Failures reject with the exit `code` and both captured streams attached, so callers classify (missing tool, cancelled, real failure) without re-running anything.

On that runner sit the **native path openers**: `openNativePath` hands a path to the operating system's default application (or the default browser, for documents a browser renders), `openNativeTextFile` opens a text document for editing, and `canOpenNativePath` reports whether either can reach a user-visible desktop at all, which headless or containerised Linux cannot. The per-platform commands are documented with their first consumer, [`host.openPath`](../../host/apiproxy/README.md).

Its consumers are the host-side native integrations: the [`directory-picker-native`](../../host/directory-picker-native/README.md) backend's OS chooser commands, the gateway's open-with-default-application hand-off ([`arx-host-apiproxy`](../../host/apiproxy/README.md) `host.openPath`), and the file-manager entries of [`arx-host-open-in-app`](../../host/open-in-app/README.md). `NativeCommandRunner` and `PathOpenerInternals` are their injectable test boundaries.

It is a **library, not a service or plugin**: no `ctx`, registers nothing, holds no state, emits no events.

## Surface

```ts
import {
  runNativeCommand, type NativeCommandRunner,
  canOpenNativePath, openNativePath, openNativeTextFile,
  type PathOpenerInternals, type PathOpenerRunner,
} from '@arx-ai/arx-native-command'
```

## Model Experience

None, as this is host-side subprocess plumbing; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No output bounding** — both streams buffer unbounded in memory; every current caller invokes small native tools whose output is a path or an error line. Adopt `arx-output-retention` bounding before pointing this at commands with meaningful output volume.
