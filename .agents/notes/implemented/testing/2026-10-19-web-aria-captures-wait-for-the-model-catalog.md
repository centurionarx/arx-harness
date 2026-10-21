# Agent Note: Web ARIA captures wait for the model catalog

Status: implemented

## Problem

The [web browser e2e lane](2026-07-24-web-gui-browser-e2e-lane.md) freezes a region's ARIA tree with `captureStableAria` in [the web test scaffold](../../../../apps/web/tests/scaffold.ts), which returned once two consecutive normalized captures were equal. The composer's model selector loads its catalog asynchronously. While the catalog loads, the trigger is enabled and labelled only "Select model"; once it loads, the trigger names the current model, as in "Select model, current DeepSeek-V4-Flash". When the catalog answered after the region already looked stable, the loading label froze into the capture and the golden comparison failed. Every capture whose region contains the composer depends on this, including the conversation column, the application frame and the composer card, and only a few tests waited for the model explicitly. On 2026-10-19 a documentation-only pull request failed the Linux web snapshot job this way in `reference-composer.e2e.ts`.

The same job also failed in `message-actions.e2e.ts`. After the Branch action, the fork test hovered the selected session row once and gave the revealed row action two seconds. Branch selects the child session only after the fork's inherited title resolves, so the hover could reach the seeded session's row or a row that re-rendered under the pointer.

## Decision

`captureStableAria` accepts a capture only when every model selector trigger inside the region names a current model or is disabled. It first waits up to 15 seconds for that condition, then polls until two consecutive normalized captures are equal and the condition still holds, so a selector that mounts or unlocks after the first check is covered. An enabled trigger labelled exactly "Select model" is not ready. That label covers both a catalog that is still loading and a loaded catalog with no current selection; the helper does not tell them apart. A disabled trigger belongs to a locked composer and is accepted as is. The condition is read in one in-page evaluation, so a trigger that unmounts during the check does not stall on Playwright's attach wait. The rule lives in the shared capture helper, not in each test, because every capture of a region with the selector depends on the same readiness.

The fork test waits until the selected row carries the child's title, "Use the read tool twice (1)", before it targets the row action. It then repeats the hover inside a 10-second poll until the revealed action is visible. Goldens are unchanged.

## Alternatives considered

**Wait in each affected test.** A few tests already did, most did not, and a new test would repeat the omission.

**Lengthen the stability window.** A longer quiet period lowers the failure rate without removing the race, and it slows every capture.

**Normalize the selector label in the goldens.** It would hide a real difference in what the user sees; the repository fixes fixtures, not normalizers.

**Add a loading attribute to the trigger.** It would give tests an explicit signal, but it changes product markup to distinguish a state that tests can already wait out through the label and disabled flag.

## Consequences

- A capture whose region keeps an enabled bare "Select model" trigger fails after 15 seconds with "model selector shows no current model before the aria capture" instead of comparing that label. This includes the settled states where the catalog loaded without the current selection, which no current golden records; such a capture needs its own assertions.
- A locked composer's trigger passes the check without proof that its catalog loaded; the goldens record no locked trigger that names a model.
- The readiness check reads the English trigger labels that the goldens use.

## Verification

The Linux `node 24 / snapshots and artifacts` job replays every web golden through the changed helper, including both former failures. A sweep of `apps/web/tests/snapshots` finds the enabled trigger with a current model in every golden that shows the selector, and the bare label only in the first-run provider guide, where the trigger is disabled.
