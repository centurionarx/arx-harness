# Agent Note: the session-header preset label opens the roster and starts a new session

Status: implemented

## Problem

[Per-session agent presets](../architecture/2026-08-03-per-session-agent-presets.md) made the session header's preset label read-only: once a turn has run, the host answers `agent-preset-locked` to a switch, and a control there would promise one it refuses. The choice lived only on the new-session screen. The owner asked for the header label to open the list of modes (Standard, PTC, Minimal, Creator) with the active one shown and marked, so a mode can be chosen from where the session is being read.

## Decision

The label in [`arx-client-ui-agent-preset`](../../../../packages/client/ui-agent-preset/README.md) becomes a button that opens the roster, with each preset's name and description and the running preset marked. The host rule is unchanged, and no path asks it to recompose a started session:

- For a started session, every other row says "Starts a new session in this mode". Picking one stages the preset on the new-session chip's controller with the introduce cue, then starts a new session in the same workspace through `workspaces.startSession()`, as the creator draft already did. The started session keeps its composition.
- A blank session switches in place through the chip's `agentPreset.select`.
- Picking the running preset does nothing.

`chooseFromHeader` decides the branch from the session's own list row, which is where the rule is enforced; the component only reports the pick.

The stage used to be spent by any list change while a started session was current. A workspace connect that has no blank session to reuse creates one, and the new row reaches the list before `sessions.open` makes it current, so that change dropped the stage and the new session opened on the deployment default. The creator draft had the same defect whenever it took that path. `AgentPresetSeatController.stage` now records the started session it was made from; `apply()` waits while that session is current, lands on the next current blank session, and still drops the stage when a different started session opens instead.

## Alternatives considered

- **Recompose the running session under the new preset.** Rejected: its history was produced under the old preset's tools, the host refuses the swap on purpose, and allowing it would need a host change, a session event for the model-visible composition, and both SDK projections.
- **Keep the label read-only and send the user to the new-session screen.** Rejected by the owner, who asked for the list in the header.
- **Offer only the presets that switch in place.** Rejected: the header is hidden while a session is blank, so that list would almost never have an entry.

## Consequences

- The header shows the running preset on a button whose menu marks it; the `agent-preset-selection` web lane records the button, the header menu, the no-op pick, and a pick that opens a new session composed under the chosen preset while the seeded session keeps its own.
- The chip and the header share one menu-row builder (`presetMenuItems`), so both surfaces show the same name and description for each preset.
- A header stage survives the list changes before its new session opens. When `startSession()` fails, the stage stays until a blank session becomes current or a different started session opens.
