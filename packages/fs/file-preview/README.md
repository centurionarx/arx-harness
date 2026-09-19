# @arx-ai/arx-file-preview

Read-only document previews over the existing authenticated Remote gateway. The browser calls `remote.filePreviews.read(sessionId, path)`; the gateway supplies the live Agent and cancellation signal. Results contain the original path, preview kind, allowlisted media type, byte count, and UTF-8 text or base64. No public file URL is created.

## Configuration and filesystem boundary

Mount the plugin beside the Agent registry and a filesystem available to each Agent. `maxBytes` defaults to 2 MiB and must be a positive safe integer no greater than 16 MiB. The bound is passed to the Agent-scoped `ctx.fs.readBytes`, and returned bytes are checked defensively before encoding. The local provider pins an open descriptor, verifies its canonical identity, and checks regular-file status and size before reading content.

Reads use the actual Agent-scoped filesystem provider and the session header's cwd. The requested path must resolve inside that workspace and identify an accessible regular file; final symlinks, directories, missing files, unsupported extensions, and invalid UTF-8 text are rejected. The owner and provider must remain current throughout the read. Unknown or detached sessions cannot use the service. A filesystem provider must preserve its own authorization, path containment, and bounded-read contract.

Supported families are Markdown, common text/code formats, HTML, PNG/JPEG/GIF/WebP/AVIF, and PDF. SVG and arbitrary binaries are refused. The companion [preview UI](../../client/ui-file-preview/README.md) treats HTML and Markdown as untrusted content and preserves explicit native opening.

## Model Experience

None, as the service only reads current files for the viewing UI and adds no model-visible input.

#### KV Cache effect

None; this package does not change model requests or their token prefixes.

## Known Limitations and Deferred Work

- Zod is a runtime dependency of the generated `./typert` and `./remote` artifacts. Source-only dependency analysis does not see those imports; the package-scoped Knip exception preserves their installed dependencies.

- Authorization and atomic filesystem semantics remain the responsibility of the Agent's provider. The local provider reads through the verified descriptor and refuses target swaps; file contents can still be edited concurrently and are not a transactional snapshot. Unsupported or large documents can be opened explicitly in the system application. Remote gateway attachment rules apply: the owner must still be a live, accessible session.
