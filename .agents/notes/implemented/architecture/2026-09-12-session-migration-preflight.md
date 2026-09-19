# Agent Note: Session migration starts with a validated immutable snapshot

Status: implemented

## Problem

Importing legacy sessions without validation can corrupt the append-only log or overwrite an existing session.

## Decision

Provide an inspect and identity-copy CLI that validates current framing, events and session reconstruction, pins a SHA-256 checksum, stages a flushed file and atomically creates a previously absent destination.

## Consequences

Source and existing target remain intact on failure. Torn records, unknown required events, symlinks and hash mismatches are refused. Filesystem tests cover these refusals and successful byte-identical copy. Structural version conversion still requires a separately reviewed adapter.

## Alternatives considered

Blindly copying the upstream migration scripts would assume incompatible storage versions. In-place conversion and overwrite were rejected because the original must remain recoverable.
