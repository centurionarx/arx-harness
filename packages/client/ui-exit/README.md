# @arx-ai/arx-client-ui-exit

English | [中文](README.zh.md)

This package fills `sidebar.exit`, the seat ui-sidebar declares below Settings, with a foot row that stops the harness. The shutdown itself belongs to the launcher: the row asks for it over `host.exit`, which the launcher answers by starting its own bounded process exit.

The row confirms before asking. The control ends the server that serves the page, so the viewer cannot undo it from the UI they are looking at; session logs are durable, so a restart resumes them. A started shutdown never returns to idle — the page it lives on is going — and the row reports `Stopping…` until the connection dies with the server. A deployment whose launcher provided no exit request answers `exit-unavailable`, and the row says so instead of resolving on a shutdown that will not happen.

`host.exit` is loopback-only. `trustedHosts` is a DNS-rebinding fence rather than authentication, so on a LAN deployment an unpinned exit method would hand any reachable caller a shutdown switch; [`arx-client-connection`](../connection/README.md) pins it beside the native dialogs and the configuration plane.

The occupant installs through `slots.inject()`, so the package works whether its row activates before or after ui-sidebar, withdraws when the declaration collapses, and leaves nothing behind on teardown. It retains no runtime state — the confirmation phase lives in the component. The node half is an empty Loader seat.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Exit is not logout** — the harness carries an anonymous identity and holds no login of its own, so the row stops the process and clears no credential. A provider credential the harness reads from its host, such as the Claude Code token, stays exactly as it was.
- **Nothing restarts the harness from the browser** — the page dies with the server, so the next start comes from a terminal or the service manager.
