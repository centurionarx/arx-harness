# Agent Note: Native session creation metadata and gateway shutdown admission

Status: implemented

## Problem

A normal isolated session has control-allocated ownership and lazy persistence metadata before its worker creates the live Agent. Independent creation timestamps make those two headers describe different sources, so the canonical session-query comparison correctly rejects export even when fork descendants agree. Asynchronous WebSocket authority resolution can also finish after gateway shutdown has taken its tracked-downlink snapshot.

## Decision

The [isolated runtime](../../../../packages/host/isolated-project-runtime/README.md#authority-and-protocol) resolves the already allocated normal header through one closed, read-only private broker operation. [ProjectStorage](../../../../packages/identity/project-storage/README.md#ownership-and-durability) reads only indexed metadata and rechecks the current owner, storage grant and cancellation. The broker revalidates the retained lease before returning. The worker checks the assigned id and cwd, and the [ApiProxy](../../../../packages/host/apiproxy/README.md#contract-layer-api) checks the preset, format version and unseeded lineage before live Agent creation. Only this trusted callback supplies the control creation timestamp; browser payloads cannot supply it. Local compositions without the callback retain their creation behavior, and fork allocation remains independent.

The [authenticated gateway](../../../../packages/client/connection/README.md#authenticated-mode) checks that it is open immediately after authority resolution, before registering a downlink. Shutdown and stream admission meet at this check without additional per-request state.

## Alternatives considered

**Materialize before the worker acknowledgement.** This creates an artifact for a creation that can still be cancelled or refused. Registration remains lazy, and the canonical empty-header commit stays after the matching worker receipt.

**Exclude the creation timestamp from source comparison.** This hides conflicting headers and weakens the canonical live-versus-durable comparison. The two producers instead consume one allocation while the comparator remains exact.

**Add pending-upgrade state.** The synchronous admission check after the asynchronous authority step closes the demonstrated shutdown interval without another request registry or lifecycle.

## Consequences

Normal live and durable empty headers share their id, cwd, preset, version and creation timestamp. The additional broker read is passive, has no model or tool effects, and supplies no physical revision token. Foreign ownership, cancellation, invalid metadata and lost authority reject the receipt. Empty-header materialization still requires successful worker creation; append retains the configured provider fsync and index FULL commit.

Focused fixtures retain exact export, fork and descendant assertions and cover normal empty headers, foreign-owner metadata, cancelled reads, real logout with a retained metadata reply and an upgrade admitted against gateway shutdown. Disposable supervisors establish these lifecycle and ownership properties; they do not establish production VM, mount, UID or network isolation.
