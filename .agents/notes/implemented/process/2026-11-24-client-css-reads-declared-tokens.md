# Agent Note: Client stylesheets read only declared custom properties

Status: implemented

## Problem

A client stylesheet that reads a custom property no stylesheet or inline style declares fails without a signal: the browser treats every declaration that reads it as invalid at computed-value time and drops it, the sheet still parses, and DOM snapshots are unchanged. Two such defects were fixed one sheet at a time ([feedback editor](../bug-fix/2026-08-13-feedback-note-editor-popover.md), [Schedule catalog](../bug-fix/2026-11-24-schedule-catalog-theme-tokens.md)), each with its own spec, and `ui-settings-models` carries a third per-sheet spec. A scan then found thirteen more fallback-free reads of undeclared names in ten other sheets, one of them outside `packages/client`. Among their effects, an invalid settings field had no red border, a failed plugin showed no error color, the Web settings button lost its label color on the brand fill, the context divider disappeared, and the preset label, job-kind badge, and agent-team task cards had no fill.

## Decision

[`verify-css-tokens`](../../../../scripts/verify-css-tokens.ts) runs with the shared static CI gates. It reads every tracked stylesheet and product TypeScript file outside `website/`, `vendor/`, and `docs/`, collects the custom properties they declare (CSS declarations, inline-style object keys, and `setProperty` arguments; CSS comments, tests, and specs are left out), and fails each `var(--name)` read without a fallback whose name none of them declares. A read with a fallback passes, because its declaration stays valid.

The changed sheets read declared tokens chosen by value and by sibling use:

- quaternary labels (a disabled preset seat, a tool row's file-link underline) and the stats separator read `--arx-alias-label-caption`, which sits between the tertiary and dimmed labels;
- the context divider reads `--arx-alias-border-l2`;
- resting fills (the preset label, the job-kind badge, agent-team task cards) read `--arx-alias-bg-module-platform`, and the agent-team member hover reads `--arx-alias-interactive-bg-hover`, so a hover still changes the fill;
- plugin failure text and invalid field borders read `--arx-alias-state-error-primary`;
- the Web settings button on the brand fill reads `--arx-alias-label-primary-foreground`, as other brand-fill buttons do;
- the preset section and job labels read `--arx-font-markdown-code-font-family`.

## Alternatives considered

- **Keep one spec per sheet** — rejected: each copy guards only the sheet that already failed, and the scan showed the defect recurring in sheets with no spec.
- **Declare the missing names as theme aliases** — rejected: it would add tokens that no design source defines, to keep names that only these sheets used.
- **Fail reads that carry a fallback** — rejected: the fallback keeps the declaration valid, so the read does not drop it.

## Consequences

- A new fallback-free read of an undeclared property fails CI with its file and line.
- A property set at runtime from a computed name is not seen as declared; the gate reports its reads until the name appears as a literal key or `setProperty` argument, or the read gains a fallback.
- A read nested in another read's fallback, as in `var(--a, var(--b))`, is checked on its own, so an undeclared `--b` fails even when `--a` is declared.
- The per-sheet specs of `ui-message-feedback`, `ui-settings-models`, and `ui-schedule` stay, because they also check layout and scrollbar rebinding that the gate does not.
