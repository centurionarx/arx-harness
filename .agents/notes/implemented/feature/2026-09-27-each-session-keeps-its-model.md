# Agent Note: Each session keeps its own model selection

Status: implemented

## Problem

The owner reported that choosing one model in a session and another model in a second session made the sessions trade models.

A pick lived only in the gateway's process-local override for one `Agent` object ([session model selector](2026-07-24-web-session-model-selector.md)), and the log recorded it only when a request consumed it into `request/header` ([default follows the picker](2026-08-07-default-model-follows-the-picker.md)). Every accepted pick also saved the shared default. Any new `Agent` for the session, after a Host restart, a gateway reload, or a cold resume, therefore fell back to the last logged request, and a session without one fell back to the shared default, which by then held another session's last pick.

Subagent delegation had the same gap: `resolveChildAgentOptions` seeded a child from the parent `Agent`'s construction-time `options`, not from the model the parent session had selected since.

## Decision

**A pick is a session event.** `SessionEventMap` gains `model/selection`, declared with `ModelSelection` in `arx-agent`. `session.selectModel` appends it after the pick validates and before it saves the shared default. It is required on read, so a build without the type refuses a log that carries it, and it never enters the derived model transcript: `request/header` still records the configuration each request used. `SESSION_FORMAT_VERSION` does not change, because the event adds vocabulary, not structure.

**The log decides a session's selection.** The gateway resolves, in order: a pick made through this `Agent` object in this process; the later of the session's last `model/selection` and last `request/header`, by log order; the shared default. `foldSessionModelSelection` is the pure fold, and `loggedModelSelection(session)` folds incrementally per session, as `Session.requestHeader()` does. `session.fork` copies the events up to its boundary, so a forked session keeps an unconsumed pick without fork-specific code.

**A pick the log already records appends nothing.** The comparison is with the selection the log records, not with the effective one, so a blank session that picks the default it was following logs that pick and keeps it after another session moves the default.

**Subagents follow the parent's selection.** `installModelSelection` registers its selection per `Agent`, and `installedModelSelection(agent)` reads it. `resolveChildAgentOptions` takes provider and model from the parent's installed selection and falls back to the parent's `options` when none is installed; `maxTokens` still comes from `options`. The continuable subagent descriptor reuses the resolved options, so it names the route the child runs.

**The cold blank probe reads up to 8 KiB by default.** A blank session grows by one Zstandard frame of about 100 to 150 bytes for each `session/end-seed` on open and each logged pick. At the former 1 KiB default, a blank session with five or six such frames stopped being verifiable as blank after a restart, so the sidebar showed it and New Session created another session. `coldBlankProbeMaxBytes` still configures the limit; the reasons for bounding the probe are in [bounded cold blank verification](../bug-fix/2026-08-13-bounded-cold-blank-verification.md).

## Alternatives considered

**Keep the process-local override and fix only subagents.** It does not survive a new `Agent` for the session, which is the reported failure.

**Append every accepted pick.** Re-confirming a model would grow a blank session's artifact without changing its selection.

**Compare a pick with the effective selection.** A blank session's explicit pick of the default would not be logged, and the session would follow the default again after a restart.

**Seed a top-level session's construction-time options from its log.** Every create, resume, and fork path already installs the live selection before the session is published, so the construction-time options mattered only where delegation read them directly.

**Keep the 1 KiB probe limit.** Blank sessions would appear in the sidebar after a few picks and restarts.

## Consequences

- Two sessions keep different models across restarts, gateway reloads, resumes, and forks, and a new session still starts from the last pick made in any session.
- A blank session that New Session reuses keeps the pick it logged, even when another session's later pick moved the shared default.
- A subagent runs on the model its parent session selected, at any delegation depth.
- A cold list reads a possibly blank artifact of up to 8 KiB instead of 1 KiB; artifacts above the limit still stay visible.
- A blank session whose picks and opens exceed 8 KiB still shows in the sidebar after a restart.
- The 1 KiB default stated in [bounded cold blank verification](../bug-fix/2026-08-13-bounded-cold-blank-verification.md) is now 8 KiB; that note is left unedited.
