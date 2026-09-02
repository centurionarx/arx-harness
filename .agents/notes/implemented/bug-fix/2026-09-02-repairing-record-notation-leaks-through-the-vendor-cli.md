# Agent Note: repairing record-notation leaks through the vendor CLI

Status: implemented

## Problem

A user reported that a model served through the vendor CLI route answered with prose that embedded `[requested NAME with ARGS]` lines instead of calling tools. The transcript renderer already prints executed tool traffic as record notation — `[requested … with …]` / `[result of ID]` — so a model that treats the transcript as a format to imitate will answer by *writing* records rather than emitting tool calls. The harness never executes them: to the loop the turn simply ends with text, and the user sees a model that looks broken or disobedient.

The defect is structural, not model-specific: any strong imitator can produce it, and the transcript is the only place a vendor-CLI model sees history. A model asked to "read the file, then run the tests" that replies with record lines stalls the loop silently.

## Decision

The leak is closed twice: a guardrail in front of the transcript, and a repair on the way out.

The transcript renderer prepends [`TRANSCRIPT_PREAMBLE`](../../../../../packages/llm/llm-agent-cli/src/prompt.ts) to the rendered history. It names the notation as a display of what the harness already executed, states that it is not an output format, and tells a model that wants to call a tool to use its real tool-calling mechanism. The preamble merges into the transcript's leading text block, or opens as its own block when the transcript starts with an image, so it adds no request slots and no per-message cost.

The second defense runs in the adapter's stream translation. When a text block stops (`content_block_stop`), the translation inspects the accumulated text for a trailing run of record requests — [`oneTrailingRecord`](../../../../../packages/llm/llm-agent-cli/src/stream.ts) requires a trailing `]`, a harness-shaped record name (`[a-z][a-z0-9_-]*`, so a Pascal-case vendor tool name like `Read` never converts), membership in the tools the request actually serves, and arguments that parse as a JSON object. A maximal trailing run of such records — `degenerateTail`, scanning in document order — converts each into a synthetic `tool-call` block at index `1_000_000` upward, keeps any preceding prose as text, and marks the turn as having made a tool call so the loop continues. Converted ids use the `converted-N` stem, which cannot collide with vendor ids the route generates.

Only the trailing run converts. Mid-sentence quotations, malformed arguments, unknown names, and requests for tools the request does not serve stay text: the model may legitimately be *showing* record notation, and converting that would fabricate a call the user never asked for. Streamed deltas for a converted block are superseded by the authoritative block-end conversion, so a UI cannot paint a record line and a call for the same span.

## Alternatives considered

**Prompt-only mitigation.** The preamble alone asks the model not to leak. Rejected as the whole fix: guardrails do not bind every model, and the user-visible failure is a stalled loop, so the harness needs a repair that does not depend on the vendor's cooperation. The preamble stays as defense one because preventing the leak is cheaper than repairing it.

**Repairing records anywhere in the text, not only in the trailing run.** Rejected: converting a record the model quoted mid-sentence manufactures a tool call out of prose and consumes the quoted content, which the user may still want to read. Only the terminal run is unambiguously an attempt at tool traffic.

**Rejecting leaked records as a hard turn error.** Rejected: a stall is the bug; failing loudly would keep it. Conversion degrades to text when the repair cannot be sure, and the guardrail keeps teaching models the notation is not a format.

## Consequences

The reported failure mode now self-heals: a prose-plus-records answer reaches the loop as prose plus real tool calls, and the session log records what the vendor actually emitted alongside what the harness executed. The `converted-N` ids and the `1_000_000`-up indices make synthetic blocks distinguishable in any transcript a developer opens.

The version the model sees, the version the harness prints into the transcript, and the version the loop executes are now three separate things with three separate sources — which is what stops notation meant to inform a model from being mistaken for traffic the harness must execute. The package README's leaked-notation section documents both defenses for whoever meets the symptom.


Package unit tests pin both behaviors: the preamble's transcript shape and the conversion rules (trailing-run-only, served-set membership, non-JSON stays text, `degenerateTail` maximality).
