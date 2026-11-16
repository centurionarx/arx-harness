# Agent Note: Notify a buffered model selection absorbed by the history window

Status: implemented

## Problem

The native project browser gate selects a model through the Host API right after resuming a session. The resume starts the session open, and the history request leaves before the Host commits the selection. The live `model/selection` event arrives while the open is loading, so the runtime buffers it. The history answer already contains the same event, and stitching drops the buffered copy as sequence overlap. The runtime emitted `session/model-selection` only when a live event was appended, so no notification fired, the model directory kept its earlier unselected and unroutable answer, and the composer stayed blocked with "Select a model to start" until the gate timed out.

## Decision

When an open or a gap repair installs a history window, stitching appends buffered live events without per-event selection notifications. If any buffered event is a `model/selection`, the bound Session emits `session/model-selection` once after stitching, whether the window already contained that event or stitching appended it. A selection present only in history, a replayed live event dropped after the window is open, an unbound Session and a disposed Session still do not notify. No session event, wire frame or Host API changes.

## Alternatives considered

**Notify for every `model/selection` in an installed window.** History-only selections would trigger a directory read on every open even though the directory's own first load already reflects them, and the existing suite pins that hydration does not notify.

**Reload the directory after every window install.** That adds a Host read per open and gap repair with no selection involved.

**Keep per-event notifications during stitching.** A buffer holding both an overlapped and a new selection would emit twice for one install.

## Consequences

An external selection committed between the open request and its history answer refreshes the directory and unblocks the composer. Each install costs at most one extra directory read, and only when the buffer held a selection. The [Session suite](../../../../packages/client/runtime/tests/session.client.spec.ts) adds the absorbed-selection case, and the [directory plugin suite](../../../../packages/client/ui-model-selection/tests/browser-plugin.client.spec.ts) adds the composer unblock over a real Session. Both fail on the code before this change. The keyless Web selection scenario selects on an already open session and keeps its expected outputs. The keyless [open-window scenario](../../../../apps/web/tests/model-selection-during-open.e2e.ts) holds the browser's history request with `holdNextApiRequest`, selects through the Host while it is held and releases it, so the installed window already contains the buffered selection; the saved default already names the picked model, so the Host's own default save emits no settings change and cannot refresh the picker. It fails without the notification after stitching and passes with it. This note refines the [scoped refresh decision](2026-10-10-session-model-selection-refresh.md) without superseding it.
