# Agent Note: Durable project orchestration with immutable revisions and explicit workflow claims

Status: implemented

## Problem

Projects need durable plans, reusable prompts, task evidence, and repeatable workflows without creating a second task engine or hiding model input outside the session record. Concurrent UI and model callers must not overwrite each other, and a process restart must not silently retry work whose external outcome is unknown.

## Decision

`@arx-ai/arx-project` stores one complete project aggregate per storage-domain key. The aggregate links to an existing workspace and contains immutable plan, prompt, and workflow revision histories alongside task and workflow-run ledgers. Every mutation compares an expected aggregate version inside the storage-domain serialized update, validates the complete candidate, commits it atomically, and publishes a cloned snapshot only after the commit succeeds.

Plan approval names one exact immutable revision and remains a trusted Remote/UI operation. The model-facing project tool can propose revisions and observe approval, but its action schema cannot approve them. Task execution records the attached workspace session and exact prompt revision; verified state requires evidence.

Prompt revisions retain the template, declared variables, and complete selected skill sources with repository, commit, path, content, and SHA-256 digest. Rendering rejects undeclared or invalid variables and returns the effective rendered prompt plus the exact skill snapshots through the ordinary model tool result. Fixed count, character, and serialized-record limits bound persistent and wire growth.

Workflow revisions define named steps and an acyclic dependency graph. Starting a run reserves a shared active slot and persists launch and elapsed-time ceilings. Claiming chooses the first dependency-ready step in definition order and commits its attempt, inputs, and consumed launch budget before returning. The service does not launch external work. A caller executes and settles each claim explicitly. Startup changes running tasks, runs, and steps to `uncertain`; that reservation remains consumed until an operator explicitly reconciles it.

## Alternatives considered

- Separate storage tables for plans, prompts, tasks, and runs would require cross-table transactions that the storage-domain contract does not provide.
- Reusing arbitrary JavaScript workflow execution would mix durable orchestration policy with an existing general workflow engine and would still leave external-effect recovery undefined.
- Automatically retrying running steps after restart could duplicate unknown external effects.
- Injecting rendered prompts privately would make the effective model input harder to reconstruct from the durable session log.

## Consequences

- A project write rewrites one bounded aggregate, giving simple atomicity and compare-and-set behavior at the cost of an explicit record-size ceiling.
- Immutable histories preserve review and provenance while revision-count limits prevent unbounded growth.
- Workflows require an active driver to claim, execute, and settle steps; the service makes no automatic-continuation claim.
- Active-run, step-count, and deadline reservations are enforced. Token reservations are deferred because no project-owned metering hook can attribute model tokens to a run reliably.

## Verification

Focused tests use the real JSON storage backend to cover concurrent compare-and-set rejection, unchanged persisted bytes and event counts after invalid writes, exact approval, workspace-owned session checks, evidence requirements, immutable prompt snapshots, unknown variable rejection, restart recovery, explicit reconciliation, shared active-run reservations, step ceilings, and deadlines. A real Cordis Loader composition test boots the service and model consumer from `cordis.yml`, verifies rendered prompt material in a tool result, and proves the model action schema rejects `approve_plan`.

Prompt revisions also retain bounded purpose, tags, examples, and stable evaluation-case semantics. An evaluation is implemented as an ordinary exact-prompt project workflow executed by the existing runner. Finalization derives substring and JSON checks, latency, and known token totals from persisted child results; truncated output is explicitly inconclusive and no price is inferred.
