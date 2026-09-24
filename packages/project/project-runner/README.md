# Saved project workflow runner

The optional `projectRunner` service executes immutable project workflow steps through the existing `subagents.start` seam. The web bundle composes it beside the project service; the `project` tool exposes `execute_workflow` when the driver is present.

A runnable definition names an exact prompt revision and typed variable values for every step. Starting a driven run binds an approved plan revision and its original parent session. Calls from another parent are refused. Children inherit that parent's preset and permission policy.

Each claim commits before child launch; the published child session is attached before settlement. Attachment verifies direct parent lineage and the canonical workspace directory, not top-level child membership. The pinned parent must remain attached to the workspace. Completed steps retain their result and are skipped on continuation. Concurrent drivers for the same project/run are refused. Holder unload aborts and awaits all owned children. A crash or ambiguous provider outcome makes the run uncertain until an operator explicitly reconciles it. Retry releases only pending or uncertain work and never reruns confirmed steps.

## Validation

Real JSON storage tests cover persisted restart after a budget stop, pending-only continuation, duplicate drivers, cancellation and uncertainty, expired deadlines, parent binding, and disposal quiescence. [Headless application snapshots](../../../examples/headless-agent/tests/project-workflow.snapshot.ts) boot the Loader composition, use the real in-process spawn provider, and preserve parent and child transcripts for automatic and manual execution; only the model responses and wall clock are controlled.

## Model Experience

### Saved workflow child input

#### What the model sees

The child receives the rendered prompt, exact selected skill content and hashes, saved input, dependency results, and a `Reconciliation key:` tuple in its ordinary user message. Children inherit the parent preset and permission policy.

#### Token effect

Each executed step adds its pinned prompt, selected skills, input and dependency results to the child request. Result previews retain at most 32,000 characters; the child session keeps full output. Usage records count measured direct-child calls only and mark missing usage as unknown.

#### KV Cache effect

Stable prompt revisions and skill snapshots remain byte-identical. Run identifiers and dependency results are explicit per-execution suffix data and never rewrite an earlier conversation prefix.

## Known Limitations and Deferred Work

- External effects are not exactly-once: a crash between provider publication and session attribution requires explicit reconciliation using the logged key. The driver requires durable local child sessions. There is no token hard cap or currency estimate; descendants are outside the direct-child usage total. Project and host ceilings limit active runs, launches and elapsed time.
