# Workflow

The workflow seam lets an agent run a model-written orchestration SCRIPT that starts subagents. Like [subagent](subagent.md) it is **one optional capability**, not part of the agent loop, so its types and operations live here rather than in [core.md](core.md). Like bash, it permits ONE engine implementation per context to provide `ctx.workflowEngine`; there is no named-provider registry (a second engine replaces the first through plugin configuration rather than running beside it).

Service Definition: [arx-workflow](../../packages/workflow/workflow) (`ctx.workflowEngine` + the vocabulary below). The Service Provider is [arx-workflow-worker-thread](../../packages/workflow/workflow-worker-thread) (a `node:worker_threads` engine — one worker per run, the script's vm context inside it); the model-facing Consumer is [arx-tool-workflow](../../packages/workflow/tool-workflow). The proposal and rationale: [the dynamic-workflows Agent Note](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md).

Sources: browser-safe vocabulary in [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts), Host request and live-run handles in [`runtime-types.ts`](../../packages/workflow/workflow/src/runtime-types.ts).

## The start request

What a caller asks for when starting a run. The ordinary workflow tool builds this from the model's `{ script, meta, args }` call plus the calling agent; specialized consumers may also select one engine-wide `subagentProvider` and lower `maxTotalAgents` for the run, but the script cannot observe or replace either policy. `meta` and `args` are plain JSON DATA (the engine validates `meta` against its schema and rejects loud BEFORE anything runs — no script text is ever evaluated to obtain it). `parent` is REQUIRED — every child the script starts is attributed to it, and cwd, lineage, and depth pass through the [subagent seam](subagent.md).

```ts type-equiv
/**
 * What a caller asks for when starting a workflow run. `meta` and `args` are
 * plain JSON data by the seam contract. `parent` is required because every
 * `agent()` spawned by the script is attributed to that live Agent.
 */
interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  /** Cancels the run when aborted. */
  signal?: AbortSignal
}
```

## The workflow's identity: `WorkflowMeta`

The identity block carried as data on the start request (the tool's `meta` parameter; the field vocabulary matches the Claude Code dynamic-workflows meta block). `phases` is progress vocabulary only: `phase()` calls match titles for observers; no execution structure is implied.

```ts type-equiv
/**
 * The script's identity block, provided as plain JSON data alongside the
 * script body (the model-facing tool carries it as its `meta` parameter) and
 * validated by the engine before the body runs. `name`/`description` are
 * required; the rest is optional annotation. The field vocabulary matches the
 * Claude Code dynamic-workflows meta block.
 */
interface WorkflowMeta {
  /** Short kebab-case workflow name (display + persistence key). */
  name: string
  /** One-line description of what the workflow does. */
  description: string
  /** Optional guidance on when this workflow applies (shown in listings). */
  whenToUse?: string
  /** Optional phase declarations matched by `phase()` calls. */
  phases?: WorkflowPhase[]
}
```

## The terminal result: `WorkflowResult`

The outcome of one run, resolved by `WorkflowRun.result`. `value` is the script's materialized return value — plain host-realm JSON data (`null` when the script returned nothing) — meaningful only for `completed`. `stopReason` is a CLOSED union (engine-owned; consumers may exhaust it): `completed` | `cancelled` | `error`. A non-`completed` reason carries the failure in `error`, and the consumer maps it to an `isError` tool result rather than reporting partial output as success.

```ts type-equiv
/**
 * The outcome resolved by a live workflow run. `value` is
 * the script's materialized return value (plain host-realm JSON data; `null`
 * when the script returned `undefined`) — meaningful only for `completed`.
 * A non-`completed` reason carries the failure in `error`; the consumer maps
 * it to an `isError` tool result rather than reporting partial output.
 */
interface WorkflowResult {
  /** The script's return value (host JSON data; `null` for no return). */
  value: unknown
  /** Why the run settled. */
  stopReason: WorkflowStopReason
  /** The failure message (present iff `stopReason` is not `completed`). */
  error?: string
  /**
   * How many `agent()` calls the run accepted over its whole lifetime. On a
   * graceful settlement this is the script-side count (calls still queued for
   * a concurrency slot included); on a termination path (grace force-settle,
   * worker death) it degrades to the host-observed count — calls queued
   * inside a terminated script are unknowable then.
   */
  agentsStarted: number
}
```

## A live run: `WorkflowRun`

The handle the consumer holds while a script executes. The consumer awaits `result`, may `cancel` mid-flight, and MUST `dispose` on every path. `result` does NOT reject — a script failure resolves with `stopReason: 'error'` — and once the run is cancelled it SETTLES within the engine's bounded grace even if the script itself never settles (the engine force-settles `cancelled`; the worker-thread engine then terminates the script's worker), so a consumer awaiting `result` is never wedged past a cancellation. `dispose()` = cancel + that bounded settle + child quiescence; it never hangs on a stuck script.

```ts type-equiv
/**
 * Holder-owned live workflow. `result` never rejects; consumers may cancel
 * and must call idempotent `dispose()` to await script and child quiescence.
 */
interface WorkflowRun {
  readonly id: WorkflowRunId
  /** The validated meta block available before the script body runs. */
  readonly meta: WorkflowMeta
  readonly result: Promise<WorkflowResult>
  /** Cancel the run and its children. */
  cancel(reason?: string): void
  /** Cancel if needed and await bounded settlement and cleanup. */
  dispose(): Promise<void>
}
```

## Failure discipline: `WorkflowError.fatal`

Hook misuse inside a script — bad arguments, unknown/deferred `agent()` options, a schema outside the [structured-output subset](../../packages/core/tools/README.md), a tripped cap, a seam start failure, cancellation — throws a `WorkflowError` with `fatal: true`. The `parallel()`/`pipeline()` combinators RE-THROW fatal errors instead of mapping the item to `null`: a typo'd option must kill the script loudly, never dissolve into something that reads as an ordinary child failure. The per-item `null` is reserved for child-run failures (a non-`completed` stop reason) and ordinary in-stage script errors.

## Events

The `workflow/*` events (`workflow/start`, `workflow/phase`, `workflow/log`, `workflow/agent-start`, `workflow/agent-end`, `workflow/end` — see the [events catalog](#cordis-surface)) are **observe-only** emits carrying DATA SNAPSHOTS: every payload starts with `WorkflowRunInfo` (id + meta), never the live `WorkflowRun`, so a subscriber cannot gain `cancel`/`dispose`, and `workflow/end` deliberately omits the result value (a listener observing outcomes must not receive a mutable alias of the caller's result). Every emit is per-listener contained — a throwing subscriber is logged, never propagated, and cannot starve the listeners registered after it — and every listener receives its own payload clone, so mutating it corrupts neither the engine nor other listeners; the containment mirrors `subagent/start`/`subagent/end`.

## Durable Chat records

The top-level `arx-tool-workflow` consumer projects display facts into its calling parent Session without changing execution ownership. It writes `tool-workflow/run-start` after a run is accepted, pairs member start and end by `runId + seq`, and writes `tool-workflow/run-end` only after the result is known and disposal reaches quiescence. Nested transport calls write no record. The first append failure disables later writes for that run, so the log remains empty or a legal continuous prefix and the tool result is unchanged.

`arx-tool-workflow/invariant` validates the same protocol before live commit and when a Session is loaded: one start per run, positive unique member sequences, paired member endings, no run ending with open members, and no updates after the run ending. A missing member ending or run ending at the log tail is valid interruption evidence rather than corruption.

`arx-client-ui-workflow-run` folds the four events through the Conversation Node engine into one `workflow-run` Chat node anchored at the run-start sequence, after the original workflow tool node. Phase groups come only from actual member starts and preserve exact strings, including the distinction between an omitted phase and `''`. Closed Locations turn missing terminal facts into interrupted presentation. The [UI package README](../../packages/client/ui-workflow-run/README.md) owns disclosure, status, and same-parent local navigation behavior.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxprojectrunner--projectrunner"></a>

### `ctx.projectRunner` — `ProjectRunner`

Holder-owned sequential driver; restart rehydrates committed step state.

```ts cordis-catalog
/**
 * Continue pending steps of a run from its original parent session. Confirmed
 * steps are skipped; uncertain effects require explicit operator reconciliation.
 * @param parent - original session owner bound when the run was created.
 * @param projectId - durable project aggregate identity.
 * @param runId - saved workflow run to continue.
 * @param signal - caller cancellation propagated to every owned child.
 * @returns the latest committed run and aggregate version.
 */
async execute(parent: Agent, projectId: ProjectId, runId: ProjectWorkflowRunId, signal: AbortSignal): Promise<ProjectRunExecution>
```

Types: [Agent](core.md) · [ProjectId](../../packages/project/project/README.md) · [ProjectRunExecution](../../packages/project/project-runner/README.md) · [ProjectWorkflowRunId](../../packages/project/project/README.md)

Source: [`packages/project/project-runner/src/index.ts`](../../packages/project/project-runner/src/index.ts)

<a id="ctxprojects--projectservice"></a>

### `ctx.projects` — `ProjectService`

Project aggregate authority and `projects/*` Remote namespace. Every write uses storage-domain's per-domain chain and compare-and-set occurs inside the queued transform, before backend durability and publication.

```ts cordis-catalog
/**
 * Return compact project snapshots in creation order.
 * @returns Fresh project summaries after service initialization.
 */
@Remote async list(): Promise<readonly ProjectSummary[]>

/**
 * Return one fresh aggregate snapshot, or undefined for an unknown id.
 * @param projectId - Stable project identifier.
 * @returns A detached aggregate snapshot when the project exists.
 */
@Remote async get(projectId: ProjectIdBrand): Promise<ProjectRecord | undefined>

/**
 * Create a project only for a registered workspace whose directory exists now.
 * @param request - Workspace, name, and optional description.
 * @returns The committed initial aggregate.
 */
@Remote async create(request: CreateProjectRequest): Promise<ProjectRecord>

/**
 * Append one validated immutable plan revision and its pending task rows.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Complete immutable plan revision input.
 * @returns The committed aggregate snapshot.
 */
@Remote async savePlan( projectId: ProjectIdBrand, expectedVersion: number, request: SavePlanRequest, ): Promise<ProjectRecord>

/**
 * Bind approval to one exact immutable plan revision.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param planRevision - Exact immutable plan revision approved by the operator.
 * @returns The committed aggregate snapshot.
 */
@Remote async approvePlan( projectId: ProjectIdBrand, expectedVersion: number, planRevision: number, ): Promise<ProjectRecord>

/**
 * Replace one approved-plan task state. Starting work requires a known
 * workspace-owned session and an existing exact prompt revision; verified
 * state additionally requires non-empty evidence.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Requested task state, evidence, and execution attribution.
 * @returns The committed aggregate snapshot.
 */
@Remote async updateTask( projectId: ProjectIdBrand, expectedVersion: number, request: UpdateProjectTaskRequest, ): Promise<ProjectRecord>

/**
 * Append one immutable prompt revision after snapshotting skill content hashes.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Prompt content, metadata, cases, and selected source skills.
 * @returns The committed aggregate snapshot.
 */
@Remote async savePrompt( projectId: ProjectIdBrand, expectedVersion: number, request: SavePromptRequest, ): Promise<ProjectRecord>

/**
 * Render one exact prompt revision for return through a logged tool result.
 * @param projectId - Stable project identifier.
 * @param promptId - Stable reusable prompt identifier.
 * @param revision - Exact immutable prompt revision.
 * @param variables - Declared values substituted without code execution.
 * @returns Effective text and exact selected skill snapshots.
 */
@Remote async renderPrompt( projectId: ProjectIdBrand, promptId: ProjectPromptIdBrand, revision: number, variables: Readonly<Record<string, JsonValue>>, ): Promise<EffectivePromptSnapshot>

/**
 * Append one immutable workflow revision with a validated dependency DAG.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Complete named workflow step definition.
 * @returns The committed aggregate snapshot.
 */
@Remote async saveWorkflow( projectId: ProjectIdBrand, expectedVersion: number, request: SaveWorkflowRequest, ): Promise<ProjectRecord>

/**
 * Set project workflow ceilings within the host safety ceilings.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Per-project active, step, and duration ceilings.
 * @returns The committed aggregate snapshot.
 */
@Remote async configureBudget( projectId: ProjectIdBrand, expectedVersion: number, request: ConfigureProjectBudgetRequest, ): Promise<ProjectRecord>

/**
 * Reserve one bounded workflow run without launching any external task.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Exact workflow revision, inputs, provenance, and limits.
 * @returns The committed aggregate snapshot.
 */
@Remote async startWorkflowRun(projectId: ProjectIdBrand, expectedVersion: number, request: StartWorkflowRunRequest): Promise<ProjectRecord>

/**
 * Atomically create an ordinary driver workflow for exact prompt evaluation cases.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Exact prompt, approved plan, parent session, and duration.
 * @returns The committed aggregate containing the evaluation and driver run.
 */
@Remote async startPromptEvaluation( projectId: ProjectIdBrand, expectedVersion: number, request: StartPromptEvaluationRequest, ): Promise<ProjectRecord>

/**
 * Persist deterministic checks from the bounded output of a terminal driver run.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Evaluation ledger identifier to finalize once.
 * @returns The committed aggregate containing comparable case results.
 */
@Remote async finalizePromptEvaluation( projectId: ProjectIdBrand, expectedVersion: number, request: FinalizePromptEvaluationRequest, ): Promise<ProjectRecord>

/**
 * Attach an accepted child session to its already-committed running claim.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Run, step, and workspace-owned child session identifiers.
 * @returns The committed aggregate snapshot.
 */
@Remote async attachWorkflowStepSession( projectId: ProjectIdBrand, expectedVersion: number, request: AttachWorkflowStepSessionRequest, ): Promise<ProjectRecord>

/**
 * Conservatively interrupt an active run and retain its reservation.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Run identifier and recorded interruption reason.
 * @returns The committed uncertain aggregate snapshot.
 */
@Remote async interruptWorkflowRun( projectId: ProjectIdBrand, expectedVersion: number, request: InterruptWorkflowRunRequest, ): Promise<ProjectRecord>

/**
 * Trusted operator increase for a run stopped by its persisted budget.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Run identifier and strictly increased applicable budget.
 * @returns The committed pending aggregate snapshot.
 */
@Remote async resumeWorkflowRun(projectId: ProjectIdBrand, expectedVersion: number, request: ResumeWorkflowRunRequest): Promise<ProjectRecord>

/**
 * Claim at most one dependency-ready step in definition order. The claim,
 * attempt number, inputs, and budget consumption commit before publication;
 * callers must launch the external work after this method resolves.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param runId - Reserved workflow run to advance deterministically.
 * @returns The committed aggregate and optional newly claimed step.
 */
@Remote async claimWorkflowStep( projectId: ProjectIdBrand, expectedVersion: number, runId: ProjectWorkflowRunIdBrand, ): Promise<ClaimWorkflowStepResult>

/**
 * Settle one claimed step; a failure or final completion releases the run reservation.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Terminal state and result or error for the running step.
 * @returns The committed aggregate snapshot.
 */
@Remote async settleWorkflowStep( projectId: ProjectIdBrand, expectedVersion: number, request: SettleWorkflowStepRequest, ): Promise<ProjectRecord>

/**
 * Resolve restart uncertainty without silently retrying the interrupted step.
 * @param projectId - Stable project identifier.
 * @param expectedVersion - Required aggregate CAS version.
 * @param request - Explicit retry or terminal failure decision.
 * @returns The committed aggregate snapshot.
 */
@Remote async reconcileWorkflowRun( projectId: ProjectIdBrand, expectedVersion: number, request: ReconcileWorkflowRunRequest, ): Promise<ProjectRecord>
```

Types: [AttachWorkflowStepSessionRequest](../../packages/project/project/README.md) · [ClaimWorkflowStepResult](../../packages/project/project/README.md) · [ConfigureProjectBudgetRequest](../../packages/project/project/README.md) · [CreateProjectRequest](../../packages/project/project/README.md) · [EffectivePromptSnapshot](../../packages/project/project/README.md) · [FinalizePromptEvaluationRequest](../../packages/project/project/README.md) · [InterruptWorkflowRunRequest](../../packages/project/project/README.md) · [ProjectIdBrand](../../packages/project/project/README.md) · [ProjectPromptIdBrand](../../packages/project/project/README.md) · [ProjectRecord](../../packages/project/project/README.md) · [ProjectSummary](../../packages/project/project/README.md) · [ProjectWorkflowRunIdBrand](../../packages/project/project/README.md) · [ReconcileWorkflowRunRequest](../../packages/project/project/README.md) · [ResumeWorkflowRunRequest](../../packages/project/project/README.md) · [SavePlanRequest](../../packages/project/project/README.md) · [SavePromptRequest](../../packages/project/project/README.md) · [SaveWorkflowRequest](../../packages/project/project/README.md) · [SettleWorkflowStepRequest](../../packages/project/project/README.md) · [StartPromptEvaluationRequest](../../packages/project/project/README.md) · [StartWorkflowRunRequest](../../packages/project/project/README.md) · [UpdateProjectTaskRequest](../../packages/project/project/README.md)

Source: [`packages/project/project/src/index.ts`](../../packages/project/project/src/index.ts)

<a id="ctxworkflowengine--workflowengine-abstract-seam"></a>

### `ctx.workflowEngine` — `WorkflowEngine` (abstract seam)

Workflow Service Definition contract. Invalid requests throw before publication; a live run is holder-owned, its result never rejects, cancellation and disposal are bounded, and disposal waits for child cleanup within that bound. Lifecycle listener failures are contained, and `workflow/end` fires exactly once as the result settles.

```ts cordis-catalog
/**
 * Parse and execute a workflow script.
 * @param request - the script, its `args`, the parent agent, and an
 *   optional cancel signal.
 * @returns the live run; its `result` resolves when the script settles.
 */
abstract start(request: WorkflowStartRequest): WorkflowRun
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="projects-events"></a>

### `projects/*` events

<a id="projectschanged--emit"></a>

#### `projects/changed` — emit

Announces a project snapshot after the aggregate committed.

```ts cordis-catalog
/**
 * Announces a project snapshot after the aggregate committed.
 * @param project Fresh durable snapshot.
 * @mode emit
 */
'projects/changed'(project: ProjectRecord): void
```

Types: [ProjectRecord](../../packages/project/project/README.md)

Source: [`packages/project/project/src/index.ts`](../../packages/project/project/src/index.ts)

<a id="workflow-events"></a>

### `workflow/*` events

<a id="workflowagent-end--emit"></a>

#### `workflow/agent-end` — emit

One `agent()` call settled (clean result, child failure, or run cancellation). Paired with Events['workflow/agent-start'] by `agent.seq`, exactly once per started call on every stop path — on an engine termination path (a worker killed past its grace) the end is engine-synthesized with outcome `'cancelled'`.

```ts cordis-catalog
/**
 * One `agent()` call settled (clean result, child failure, or run
 * cancellation). Paired with {@link Events['workflow/agent-start']} by
 * `agent.seq`, exactly once per started call on every stop path — on an
 * engine termination path (a worker killed past its grace) the end is
 * engine-synthesized with outcome `'cancelled'`.
 * @param info - the run's identity snapshot.
 * @param agent - the call identity plus its outcome.
 * @mode emit
 */
'workflow/agent-end'(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowagent-start--emit"></a>

#### `workflow/agent-start` — emit

One `agent()` call established a published child run. Paired with Events['workflow/agent-end'] by `agent.seq`. A call that never receives a published run from the provider emits neither event in this pair.

```ts cordis-catalog
/**
 * One `agent()` call established a published child run. Paired with
 * {@link Events['workflow/agent-end']} by `agent.seq`. A call that never
 * receives a published run from the provider emits neither
 * event in this pair.
 * @param info - the run's identity snapshot.
 * @param agent - the call's sequence number, label, phase, and child id.
 * @mode emit
 */
'workflow/agent-start'(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowend--emit"></a>

#### `workflow/end` — emit

A workflow run settled (any stop reason). Fired when WorkflowRun.result resolves. Paired with Events['workflow/start'].

```ts cordis-catalog
/**
 * A workflow run settled (any stop reason). Fired when
 * {@link WorkflowRun.result} resolves. Paired with
 * {@link Events['workflow/start']}.
 * @param info - the run's identity snapshot.
 * @param result - the outcome data (stop reason, error, agent count) —
 *   deliberately WITHOUT the result value (see {@link WorkflowResultInfo}).
 * @mode emit
 */
'workflow/end'(info: WorkflowRunInfo, result: WorkflowResultInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowlog--emit"></a>

#### `workflow/log` — emit

The script emitted a narration line (a `log(message)` call).

```ts cordis-catalog
/**
 * The script emitted a narration line (a `log(message)` call).
 * @param info - the run's identity snapshot.
 * @param message - the logged message, verbatim.
 * @mode emit
 */
'workflow/log'(info: WorkflowRunInfo, message: string): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowphase--emit"></a>

#### `workflow/phase` — emit

The script entered a phase (a `phase(title)` call) — progress grouping for observers; no execution semantics.

```ts cordis-catalog
/**
 * The script entered a phase (a `phase(title)` call) — progress grouping
 * for observers; no execution semantics.
 * @param info - the run's identity snapshot.
 * @param title - the phase title, verbatim.
 * @mode emit
 */
'workflow/phase'(info: WorkflowRunInfo, title: string): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowstart--emit"></a>

#### `workflow/start` — emit

A workflow run started — the script's meta block validated, the body about to execute. Paired with Events['workflow/end'].

```ts cordis-catalog
/**
 * A workflow run started — the script's meta block validated, the body
 * about to execute. Paired with {@link Events['workflow/end']}.
 * @param info - the run's identity snapshot (id + meta).
 * @mode emit
 */
'workflow/start'(info: WorkflowRunInfo): void
```

Source: [`packages/workflow/workflow/src/index.ts`](../../packages/workflow/workflow/src/index.ts)
<!-- END GENERATED cordis-surface -->
