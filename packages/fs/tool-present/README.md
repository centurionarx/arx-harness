# @arx-ai/arx-tool-present

English | [Português](README.pt-BR.md)

The `present` tool validates existing regular files through `ctx.fs` and records their references in the calling agent's open turn. It accepts files created by shell commands, external programs, or filesystem tools. It does not create, upload, copy, freeze, or read file contents. Relative paths retain their original spelling and resolve against the owning Session's working directory, including after a fork.

## Configuration

| Field | Default | Meaning |
|---|---:|---|
| `maxFiles` | `8` | Maximum submitted files per call, including repeated paths. |
| `maxMetadataBytes` | `16384` | Inclusive UTF-8 cap on the complete `deliverables/presented` payload, including the turn, call id, paths, descriptions, and JSON punctuation. |

Both limits must be positive safe integers; invalid configuration fails at load. The byte limit bounds reference metadata, not file contents. The tool rejects an empty list, blank path, missing working directory, absent or closed owning turn, unavailable file, final-component symlink, directory, and special file. Provider access errors propagate. Validation checks path metadata without following the final component, then resolves and checks target metadata; no Node filesystem fallback bypasses the configured provider.

## Delivery lifecycle

Input is `{ files: [{ path, description? }] }`; the canonical result is `{ turn, files }`. The tool validates every file before accepting the list. Cancellation or a changed owning turn during validation fails the call without a delivery event.

The final `tools/result` observer appends one `deliverables/presented` event carrying `{ turn, callId, files }` only for an accepted successful result while the original turn remains open. A post-execute denial publishes no delivery. The Session envelope owns session identity; the payload's call id also supports nested Code Mode calls. The [Web deliverables plugin](../../client/ui-deliverables/README.md) combines these events with successful mutation locations and uses its existing file opener.

The registry contains observer failures. If the append fails or the turn closes before publication, no reference is recorded and the host logs the failure; the returned result confirms metadata validation only. Session persistence keeps its ordinary asynchronous append/flush contract.

## Attribution

Adapted from [DeepSeek Harness tool-present at c291e7961a515f6d7af9304e7fd1d257929aef26](https://github.com/deepseek-ai/deepseek-harness/tree/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/fs/tool-present), copyright 2026 DeepSeek, under the [MIT license](LICENSE). The arx adaptation preserves its successful-result publication approach, uses arx's existing turn log, and adds bounded reference metadata and explicit failure semantics.

## Model Experience

### Tool schema and result

#### What the model sees

The [generated tool schema](../../../docs/tool-catalog.md#arx-aiarx-tool-present) asks the model to declare requested output files after writing them and before its final response, including shell-created files. Success renders `Validated file for delivery: <path>` for each accepted file, followed by `Current file contents are not copied or preserved.` It does not claim an upload, immutable artifact, or successful persistence flush. Failure text identifies the invalid path or bound.

#### Token effect

The schema is a fixed request cost while mounted. File paths and optional descriptions remain in the tool call and canonical result; the rendered result adds one line per file. The log-only delivery event adds no separate model message.

#### KV Cache effect

Schema visibility affects the request prefix. Tool results extend history append-only; the log-only delivery event does not change the model prompt.

## Known Limitations and Deferred Work

- `deliverables/presented` is a required event. Current builds recognize it through the repository event catalog even when this plugin is disabled; older builds that do not recognize it refuse to reconstruct the session. Downgrading such a log is not supported.
- Files remain live references: later edits, deletion, permission changes, or replacement may change what the user opens. Metadata checks do not certify file contents or prevent a subsequent filesystem race.
- Source metadata access follows the provider; the tool does not perform an additional file-content read or impose a file-size limit.
- Delivery publication is an observer operation. A failed append cannot retroactively change the accepted tool result; that result intentionally reports validation only.
- Descriptions remain in the durable event and canonical result; the compact Web file row displays file names and paths.
- Backend-relative or remote paths require the host's existing file opener to support that filesystem.
