# Agent Note: The Schedule catalog menu reads declared theme tokens

Status: implemented

## Problem

The Session-header Schedule catalog menu (`packages/client/ui-schedule/src/client/ScheduleCatalogAction.module.css`) read `--dsw-*` custom properties and rebound `--dsh-scrollbar-thumb{,-hover}`. No theme sheet, built stylesheet, or runtime code declares those names; the theme declares `--arx-*` tokens and its scrollbar reads `--arx-scrollbar-thumb{,-hover}`. An undeclared custom property has no fallback, so every declaration that read one was invalid at computed-value time and dropped: the menu rendered without its surface, label and status colors, shadow, and themed scrollbar, while the sheet parsed and the DOM was unchanged.

## Decision

The sheet reads the `--arx-*` token for each name (`--arx-specific-menu`, the `--arx-alias-label-*` and `--arx-alias-state-*` colors) and rebinds `--arx-scrollbar-thumb{,-hover}` to the l2 scrollbar tokens, as the other elevated menus do. The elevation becomes `--arx-shadow-lv3` plus a 1px `--arx-alias-border-inverted` ring, the shadow and edge token `PopupSelectView` and `Menu` use; the ring is a box shadow rather than a border so the fixed 336px box keeps its size.

`packages/client/ui-schedule/tests/styles.client.spec.ts` reads the sheet and the theme sheets from disk and fails when the sheet reads a variable that neither declares, and when its scrollbar rebinding names anything other than the two variables the theme scrollbar reads. The assembled-Web Schedule e2e opens the catalog and compares the menu's computed surface and row color with the resolved tokens.

## Alternatives considered

- **Declare `--dsw-*` aliases in the theme** — rejected: it keeps a second token namespace alive for one stylesheet, and every other client sheet already reads `--arx-*`.
- **Only a per-sheet spec** — not sufficient alone: the same defect existed in other client sheets, so [`verify-css-tokens`](../../../../scripts/verify-css-tokens.ts) now checks every client stylesheet ([CSS token gate](../process/2026-11-24-client-css-reads-declared-tokens.md)); the per-sheet spec keeps the scrollbar-rebinding check, which the gate does not make.

## Consequences

- The catalog menu shows the themed surface, edge, shadow, label colors, overdue state, and scrollbar in both themes.
- The repository-wide gate reports an undeclared read in any client stylesheet; this sheet's spec adds the scrollbar-rebinding check.
