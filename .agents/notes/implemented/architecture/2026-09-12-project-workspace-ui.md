# Agent Note: Project workspace keeps approvals and execution evidence attached to immutable plans

Status: implemented

## Problem

Plans, reusable prompts, task evidence and workflow state lacked a shared browser workspace.

## Decision

A sidebar Projects modal uses generated Remote calls and framework workspace state. Plans retain immutable revisions and stable item ids. Approval is an exact-revision operator action and is disabled while the plan editor contains unsaved changes. All writes carry the last-read aggregate version.

## Consequences

Stale writes preserve the draft until explicit refresh. Prompt variables, project limits and uncertain-run reconciliation have structured controls. Execution links open the recorded session. Component tests and an assembled browser transcript validate revision history, dirty-draft approval and layout at 390px and 1440px. Creation fields wrap on narrow screens instead of compressing their controls.

## Alternatives considered

A second client persistence store would duplicate the project domain. Automatic conflict merging could approve or overwrite a revision the operator did not inspect.
