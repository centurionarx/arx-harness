# Close a development round

This procedure applies to implementation, diagnosis, review, validation, and planning rounds. The responsible agent closes each round with a verifiable handoff, including rounds whose product result is FAIL or BLOCKED. The [decision record](../../.agents/notes/implemented/process/2026-10-10-every-round-leaves-a-verifiable-handoff.md) owns the rationale.

A handoff identifies the current state without requiring the previous conversation. Product acceptance and documentation closure are separate results: a failed product can have complete documentation, while passing tests with a missing handoff leave the round incomplete.

## Prerequisites

Read the applicable agent instructions, approved scope, current task, and existing handoff. Identify the authoritative source, environment, owner permissions, and previous sealed checkpoints. Preserve completed evidence and name the new checkpoint before writing results. A worktree or staging copy containing unpublished work must remain identifiable.

## Procedure

1. Record the objective, actual scope, timestamp, product result, source location, and source fingerprint. Identify the published base when applicable. Distinguish the tested source from subsequent documentation changes and preserve their identities.
2. Update affected README, JSDoc, architecture, and decision records under the [documentation standard](../AGENTS.md). Update the operational handoff, current plan, task, and status. Durable documentation states current behavior; operational receipts own execution history.
3. Record commands, exit results, skips, review reports, and receipt paths. Separate passing checks, failed checks, diagnostics, unexecuted verification, hypotheses, and demonstrated causes. Existing failures remain failures until a corresponding changed-source check passes.
4. List prioritized remaining work and the next concrete action. Include required dependencies, fixtures, storage locations, and source-restoration inputs. Record granted authority and pending decisions; development authority does not expand application roles or operating permissions.
5. Wait for delegated work and reviews to settle. Run the pertinent documentation checks and the [mandatory Graphify lifecycle](project-analysis-integrations.md#mandatory-task-lifecycle). Check the final source identity and protected artifacts. Additional source changes require another final check and Graphify refresh; receipt-only annotations may complete operational metadata afterward.
6. Validate current links. Transfer authorized handoff files and selected evidence to the receiving environment and verify hashes. Identify the authoritative entry document, package contents, omitted execution data, and the inputs needed to reproduce the source. Record any blocked transfer rather than asserting delivery.
7. For each phase, advance the shared system version through the [release workflow](../development.md#version-cadence). Run the pertinent [pre-push checks](../../.agents/skills/arx-pre-push-checks/SKILL.md) before publishing source and handoff through the authorized Git workflow; a failed pertinent check blocks an ordinary push. Record the commit, pull request, live CI result, and any publication blocker. Product acceptance also controls promotion to the default branch. Publication does not change a failed product result; a phase remains incomplete while its required publication is missing.
8. Record documentation closure separately from product acceptance and report both. A round is complete only when its handoff is current and verifiable. A stopped round leaves an explicit progress checkpoint and next action instead of a terminal completion claim.

## Required handoff data

The entry document leads to the approved scope, current source and status, decisions, test and review evidence, remaining work, and operating authority. It identifies which source version each result exercises. If another developer needs a private staging environment or a delta over a specific base, the handoff names those inputs and their limitations.

Keep credentials, tokens, private user content, and live secret values out of the handoff. Preserve sealed packages and historical receipts; use a new identifier for each checkpoint. Publication and version advancement are required for every phase in the owner-approved scope. Obtain separate authority for merging when it is not already granted, service activation, infrastructure, real accounts, migrations, and external messages.

## Verify closure

Confirm that the current links resolve, the receiving copies match their recorded hashes, the source and protected artifacts match the final receipt, and the required documentation checks and Graphify refresh have completed. Any missing item leaves documentation closure incomplete, independently of the product result.

The [session handoff policy](../../.agents/notes/implemented/process/2026-09-29-a-long-session-names-its-handoff-point.md) also applies when a session becomes long. This procedure preserves project documentation; a continuation prompt remains chat output.
