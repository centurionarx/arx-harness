# Session migration preflight

The arx event format remains version 0. DeepSeek's later format numbers are not compatible merely because arx originated there: arx owns additional required events and message shapes. No upstream conversion is run automatically.

## Inspect a snapshot

Run `pnpm session:migration inspect /absolute/path/session.jsonl` against an offline plaintext JSONL snapshot. Inspection validates the header, current-format event envelopes, contiguous sequence numbers, supported required event types, and the current Session restore boundary. Unknown events explicitly marked ignorable are preserved. Torn tails, unsupported versions, unknown header fields, invalid UTF-8, and files above 64 MiB are refused. The command prints metadata, event names, and a SHA-256; it never prints transcript content.

## Publish a verified copy

Run `pnpm session:migration copy /absolute/path/session.jsonl /absolute/path/new-copy.jsonl --expect-sha256 <hash-from-inspection>`. The source must still match the reviewed checksum. The destination must be new. The command stages and flushes the exact validated bytes beside the target, then publishes with an atomic no-clobber hard link and removes its temporary name. Source and pre-existing destination bytes remain unchanged.

The copy is a snapshot, not a lock on an actively running session. Stop writes when preparing a migration set. Preserve the original archive and inspection output for rollback and evidence. The tool does not modify the runtime's selected session directory.

## Known limitations

Only an identity copy of the current arx format is supported. A new structural format needs a separately reviewed adjacent-version adapter with frozen source and target fixtures before this command may convert it. Format 3 from DeepSeek is explicitly refused. Compressed JSONL and SQLite stores require an export to plaintext through their existing export paths. Publication requires hard-link support in the destination filesystem; an unsupported filesystem fails without overwriting a destination. Header and event-envelope checks do not substitute for plugin-specific semantic validation.

## Validation

The filesystem tests cover checksum mismatch, existing destinations, source preservation, exact output bytes, symbolic-link refusal where supported, unsupported formats and required events, sequence gaps, torn tails, and temporary-name cleanup.
