# `@arx-ai/arx-project`

`ctx.projects` stores each project as one atomic aggregate linked to a registered workspace. The aggregate contains immutable plan, prompt, and workflow revisions plus mutable task and run ledgers guarded by an exact aggregate version.

Every mutation takes `expectedVersion`. A stale caller receives `ProjectConflictError`, and storage-domain performs the comparison inside its serialized write slot before durability. Successful writes replace the complete record, then publish a fresh `projects/changed` snapshot.

Plans retain stable item ids, acceptance criteria, and a validated acyclic dependency graph. Approval names one exact revision. Task execution can begin only for the approved revision and records a workspace-owned session plus an exact prompt revision; `verified` additionally requires evidence.

Prompt revisions retain their template, variable declarations, and complete source skill snapshots with repository, commit, path, content, and SHA-256 hash. `renderPrompt()` returns the rendered prompt and those sources together so the tool consumer records the effective model input in the ordinary tool result log.

Workflow definitions are immutable revisions of explicitly named dependency steps. Runs reserve project and host active slots and persist the exact approved plan, parent session, deadline, launch ceiling, per-step input, child session, result, and attempt before state is published. `claimWorkflowStep()` selects one ready step deterministically and never launches it. Callers explicitly settle and claim subsequent steps. Settlement retains the reported step outcome but fails the run if its deadline has elapsed, including at the exact deadline; a reported step failure retains its own error. An explicit duration increase can resume a deadline-failed run without repeating completed steps. Startup converts running tasks, runs, and steps to `uncertain`; uncertain runs retain their reservation until `reconcileWorkflowRun()` resolves them.

## Configuration

- `maxActiveRuns` is the host-wide safety ceiling; new projects start with the same value as their adjustable per-project ceiling; default `8`.
- `maxStepsPerRun` is the host ceiling for per-project and per-run launch budgets; default `100`.
- `maxRunDurationMs` is the host ceiling for per-project and per-run elapsed deadlines; default `3600000`.
- Plan history is capped at 100 revisions with at most 1,000 items per revision.
- Prompt and workflow history are capped at 100 revisions per identity. Prompt templates, selected skill sets, variable sets, individual skill content, and the complete serialized aggregate have fixed size ceilings.

## Model Experience

Indirectly, through `@arx-ai/arx-tool-project`, which returns project records and effective prompt snapshots in logged tool results.

#### KV Cache effect

Project data changes only tool results requested by the model; this service contributes no prompt prefix directly.

## Known Limitations and Deferred Work

- **Explicit workflow driver** — this package persists deterministic claims and settlements but does not launch sessions or automatically continue a run; a caller must execute each claimed step and return its result.
- **No token meter reservation** — run limits cover active slots, launches, and elapsed time because no project-owned token-meter hook currently attributes tokens to a workflow run.


Prompt revisions retain bounded purpose, tags, examples, and stable deterministic evaluation cases. Evaluations run through the ordinary project runner and persist transparent acceptance, latency, and known token results; truncated output is inconclusive.
