# Agent Note: Client stylesheets read only declared custom properties

Status: implemented

## Problem

A client stylesheet that reads a custom property no stylesheet or inline style declares fails without a signal: the browser treats every declaration that reads it as invalid at computed-value time and drops it, the sheet still parses, and DOM snapshots are unchanged. Three such defects were fixed one sheet at a time ([feedback editor](../bug-fix/2026-08-13-feedback-note-editor-popover.md), [Schedule catalog](../bug-fix/2026-11-24-schedule-catalog-theme-tokens.md)), each with its own spec, while a scan found eleven more fallback-free reads in ten other sheets. Among their effects, an invalid settings field had no red border, a failed plugin showed no error color, the Web settings button lost its label color on the brand fill, the context divider disappeared, and two badges had no background.

## Decision

[`verify-css-tokens`](../../../../scripts/verify-css-tokens.ts) runs with the shared static CI gates. It reads the tracked CSS and TypeScript under `packages/client` and `apps/web/src`, collects every custom property declared in that CSS and every name that TypeScript sets as an inline-style key or a `setProperty` argument, and fails each `var(--name)` read without a fallback whose name none of them declares. A read with a fallback passes, because its declaration stays valid.

The ten sheets read declared tokens chosen by value and by sibling use:

- quaternary labels (a disabled preset seat, a tool row's file-link underline) and the stats separator read `--arx-alias-label-caption`;
- the context divider reads `--arx-alias-border-l2`;
- the preset label and job-kind badges read `--arx-alias-interactive-bg-hover`, the subtle fill most client sheets use;
- plugin failure text and invalid field borders read `--arx-alias-state-error-primary`;
- the Web settings button on the brand fill reads `--arx-alias-label-primary-foreground`, as the other brand-fill button does;
- the preset section and job labels read `--arx-font-markdown-code-font-family`.

## Alternatives considered

- **Keep one spec per sheet** — rejected: each copy guards only the sheet that already failed, and the scan showed the defect recurring in sheets with no spec.
- **Declare the missing names as theme aliases** — rejected: it would add tokens that no design source defines, to keep names that only these sheets used.
- **Fail reads that carry a fallback** — rejected: the fallback keeps the declaration valid, and three current reads rely on it for the monospace stack.

## Consequences

- A new fallback-free read of an undeclared property fails CI with its file and line.
- A property set at runtime outside TypeScript string keys, such as one built from a computed name, is not seen as declared; the gate then reports its reads until the name appears as a literal or the read gains a fallback.
- The per-sheet specs of `ui-message-feedback`, `ui-settings-models`, and `ui-schedule` stay, because they also check layout and scrollbar rebinding that the gate does not.
