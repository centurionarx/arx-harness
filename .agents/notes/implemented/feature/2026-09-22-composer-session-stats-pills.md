# Agent Note: composer session stats as two pills with click-open dialogs

Status: implemented

## Problem

The session stats under the composer (`StatsLine` on `conversation.composer.dock`) rendered every figure as one text line: turn and step counts, LLM and tool wall times, TTFT and throughput averages, cache-hit share, and compact input and output totals. The line crowded as figures accumulated and elided with a hover tooltip that restated the same compact text, so exact token counts appeared nowhere, and time and billing figures read as one undifferentiated row. The context-occupancy ring sat apart from it, in the toolbar beside the send button. The owner asked for the two pills with click-open dialogs that the upstream snapshot source adopted after this repository was copied from it (upstream commits `3997f36999`, `2c45dfe71e`, and `b6726fe79d`).

## Decision

`StatsPills` ([`StatsPills.tsx`](../../../../packages/client/ui-conversation/src/client/chat/StatsPills.tsx)) replaces `StatsLine` on the same `conversation.composer.dock` entry and keeps its helpers (`deriveStats`, `formatTokens`, `formatDuration`, `cacheHitPercent`, `billedInputTokens`, `contextOccupancy`) in the renamed module.

- **Two pills, two dialogs.** A gauge pill shows `{turns} turns {steps} steps` plus the output speed and opens **Session statistics** (LLM time, tool time, average TTFT, tokens per second). A log with no timed figure would open an empty dialog, so that pill renders as a static reading instead of a button. A database pill shows the compact total of every billed bucket plus the cache-hit share and opens **Token usage** with exact counts: cache hit, uncached input, cached input, cache write when non-zero, and output.
- **One dialog at a time.** The row owns one open slot, so opening either dialog closes the other. Each button carries an `aria-label` that separates with ` · ` the segments the hidden separator glyph joins visually.
- **Shared dialog seat.** [`stat-dialog.ts`](../../../../packages/client/ui-conversation/src/client/chat/stat-dialog.ts) portals the panel to `document.body` above its trigger, clamps it inside the viewport, and closes it on Escape or an outside pointerdown. That needed two backward-compatible options in `arx-client-ui-primitives`: `useAnchoredPosition({ side: 'top' })` and a portal ref on `useDismissOnOutsidePointer` that counts the portaled panel as inside.
- **Context occupancy joins the row.** `InputBar` renders a dock row below the card holding the composer dock slot and then the `ContextMeter`, which now shows its percentage beside the ring. The dock row adds 4px above itself and the root's bottom padding drops to 4px while the row has content, keeping the 8px clearance; the hero, which renders no dock slot, hides the empty row.
- **Data sourcing is unchanged.** Counts and times prefer the durable `sessionStats` projection with the window fold as the fallback for assemblies without the unit ([whole-session counts](../bug-fix/2026-08-12-full-session-turn-step-counts.md)); token figures ride `tokenUsage` only, so an absent projection drops the usage pill instead of showing window-derived billing. The row still folds settled nodes only, so streaming chunk frames cause no rerender.
- **Exact counts are localized.** `formatExactTokens` groups digits with the `number.groupSeparator` locale key, and every pill and dialog label comes from the `conversation` namespace. The unused `stats.llm`, `stats.toolCall`, `stats.ttftAverage`, `stats.tokensPerSecond`, and `stats.tokens` keys are removed.

## Alternatives considered

- **Port the upstream files at their latest revision.** Rejected: that revision depends on upstream features this repository does not have — a performance/usage display preference, per-turn usage pills (`TurnUsagePanel`), and a locale-owned token formatter module — so a verbatim port would drag them in. The port keeps this repository's helpers and adds only the pieces the pills need.
- **Keep the single text line and add a tooltip with exact counts.** Rejected: a tooltip is hover-only and restates text, while the owner's reference is click-open dialogs, and grouping time and billing into separate pills matches the two projections that feed them.
- **Keep the context ring beside the send button.** Rejected: occupancy is a session statistic, and the dock row gives it the same reading tier and click-open behavior as the other two.

## Consequences

- Every web golden that captures the settled composer changes in the dock only: the text strip becomes the pill buttons, and the context meter moves from the toolbar to the end of the dock row with its percentage as visible text.
- `react-dom` joins the package's development dependencies for `createPortal`, as in the other client packages that portal surfaces.
- The generated client slot catalog names `client-ui-conversation StatsPills id 'stats'` as the dock occupant.
