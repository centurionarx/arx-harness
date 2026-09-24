# Agent Note: Fail-closed settings wire redaction

Status: implemented

## Problem

A settings value can contain a secret behind a union, intersection or transform rather than directly beneath an object, dictionary or array. Returning unsupported nodes unchanged exposes that value. Redacting only resolved values is also insufficient: schema defaults, composition defaults, raw user sections and validation errors can carry the same credential. A client that skips the descriptor request can still invoke the write executor directly.

## Decision

The [settings redactor](../../../../packages/settings/settings/src/redact.ts) checks the complete live schema graph on every projection, including absent properties, empty containers and every union branch. It accepts primitive data, objects, dictionaries, arrays, shared references and secret-free unions. Unsupported nodes and cycles refuse the operation with value-free diagnostics. A node explicitly marked `role('secret')` is opaque, so it can contain an otherwise unsupported schema without exposing its value. Unknown object properties are omitted rather than copied.

The serialized schema is a data-only Schemastery uid/refs envelope constructed from the checked graph, not by calling `schema.toJSON()`. Defaults at every node use the same projection as runtime data, including container defaults. Opaque secret nodes become write-only strings with no default, constant value or executable relation. Metadata must be JSON-compatible; schema descriptions and dictionary keys remain plugin-authored public data. Redaction precedes cloning so an opaque function or other non-cloneable secret cannot escape through a clone diagnostic.

The [API proxy](../../../../packages/host/apiproxy/src/api-proxy.ts) checks a redacted descriptor before each write and projects the response again after persistence. This applies to direct update, replace and mutate calls, not just callers that opened an editor. Schema, owner-validator, provider and document-preparation exception text is withheld from wire diagnostics. Revision conflicts, unavailable providers, unknown namespaces and read-only status retain safe dedicated outcomes. Settings publication and observer warnings omit exception contents because callbacks receive unredacted data.

## Alternatives considered

- **Choose the first validating union branch.** A different branch can classify the same property as secret, and validation can execute transforms. Secret-bearing unions are refused; authors can mark the whole subtree opaque instead.
- **Reject every union.** Current pi-ai settings use primitive/object chat-template values, false/dictionary reasoning capabilities and discriminated retry policies. Rejecting those secret-free schemas would disable ordinary product configuration.
- **Strip only secret leaf defaults from the original envelope.** Parent container defaults can embed the same values, and transform callbacks can serialize executable text. Constructing the checked envelope handles both without evaluating callbacks.
- **Sanitize exception messages by replacing known secret strings.** Errors may format, truncate or derive values, and owner validators can quote fields not yet classified as secret. Value-free diagnostics provide a reliable guarantee at the cost of detailed wire validation messages.

## Consequences

The [request-level configuration decision](../architecture/2026-07-29-request-level-llm-config-credentials.md) retains credential references and per-request resolution; its deferred settings-wire redaction is implemented here. The [configuration-plane decision](../architecture/2026-07-30-config-plane-boundaries.md) and [plugin-owned settings decision](../architecture/2026-08-12-plugin-owned-settings-surface.md) retain their independent caller, revision and namespace-ownership rationale; this note resolves their composite-schema, default and settings-error redaction gaps. None of these decisions is fully superseded or archived.

Unsupported schemas or incompatible stored fields refuse the complete descriptor request; repair may require the local settings document. Same-process reads remain privileged. Unmarked credentials in ordinary string fields, including provider headers, cannot be identified by structural redaction. Provider-specific file-parser logs and unrelated credential/model-discovery RPC diagnostics remain outside this change.

Focused unit tests cover composites, shared refs, cycles, defaults, metadata and callback exclusion. Product-schema tests exercise the actual pi-ai, agent-loop and default-model schemas. Direct API-proxy tests cover executor refusal, schema mutation, recursive inputs and response/diagnostic secrecy. A keyless Loader composition boots the real file provider and owner, snapshots the settings RPC output and verifies that a safe write preserves the stored fixture secret. It uses no external model provider or real credentials; a browser end-to-end run and repository-wide checks are not part of this verification.
