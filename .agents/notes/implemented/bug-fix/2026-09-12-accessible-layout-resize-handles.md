# Agent Note: Layout resize handles support keyboard and interrupted gestures

Status: implemented

## Problem

[`AppFrame`](../../../../packages/client/ui-layout/src/client/AppFrame.tsx) exposed the sidebar and details boundaries as pointer-only `div` elements. They had no focus target, accessible separator semantics, value range, or keyboard operation, so a keyboard user could open a panel but could not resize it. The pointer lifecycle also assumed every accepted press ended in `pointerup`: `pointercancel` or unexpected capture loss left the local handle and frame-wide drag flags set, preserving disabled track transitions after the gesture had ended. A release used the last `pointermove` coordinate instead of `pointerup.clientX`, losing the final displacement when the browser delivered no move at the release position, and secondary mouse buttons entered the same resize path as the primary button.

## Decision

Each rendered boundary is a focusable vertical ARIA separator with its Chinese accessible name and current, minimum, and maximum width. Left and Right Arrow move the separator by 16 CSS pixels through the same clamped store action as pointer input; moving right widens the sidebar and narrows the right-anchored details panel. Pointer admission accepts only the primary mouse button and one active pointer. Release commits its own coordinate, while cancellation or unexpected capture loss cancels a pending animation frame, drops both drag flags, and preserves the last width already committed by a completed frame.

The existing animation-frame throttle remains the only pointer-move publication path. The focused component test measures two move events before one frame as one store notification. The cancellation regression starts one pending frame, cancels it, advances time, and observes zero width notifications and zero remaining timers, so the fix removes the stale post-cancellation write as well as the stuck visual state.

## Alternatives considered

**Add keyboard buttons beside each panel** — rejected because the boundary itself is the resize control. Separate buttons would duplicate state, occupy shell space, and leave assistive technology without the standard separator value semantics.

**Treat cancellation as a final release** — rejected because a canceled gesture has no reliable terminal coordinate. Committing the most recent queued coordinate would publish movement after the platform withdrew the gesture; preserving only widths whose animation frame already completed has a clear commit point.

**Handle `pointercancel` without tracking the accepted pointer** — rejected because a later or unrelated pointer event could end another pointer's active gesture. One active pointer id makes release, cancellation, and capture loss idempotent.

## Consequences

Keyboard and assistive-technology users can discover and resize every currently open panel, with the spoken value updating after each key. Pointer release retains its last coordinate even without a matching move event, secondary-button input is inert, and interrupted gestures restore track transitions without a delayed store write. The separator values describe the rendered widths; details concession can therefore lower the announced value below its preferred store width while keeping the declared minimum at the user-resizable floor.

The focused jsdom suite covers semantics and bounds for both handles, directional key behavior for left- and right-anchored panels, release without a final move, cancellation with a pending frame, secondary-button rejection, and the retained one-write-per-frame throttle. Browser rendering remains responsible for the platform's native pointer-capture event ordering and focus-ring painting.
