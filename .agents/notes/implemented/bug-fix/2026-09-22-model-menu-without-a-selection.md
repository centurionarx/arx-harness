# Agent Note: the composer's model menu never loaded for a session with no model selected

Status: implemented

## Problem

A session with no model selected could not select one. The composer's model menu opened on "Refreshing model list…" and stayed there: no models, no error, no retry. A fresh install has no default model, so every first run landed here — a user who had configured a provider could see it on the Models page and still had no way to pick one of its models.

The Host answered correctly and quickly. `session.models` spells "no selection" by omitting `current`, which is what `SessionModels` declares (`current?: ModelSelection`). The browser's value schema for that response declared `current` required, so the API client refused the Host's own answer with a validation error. `satisfies z.ZodType<...>` did not catch the mismatch: a schema whose output has a required field is assignable to a type whose field is optional.

The refusal was also invisible. `ModelDirectory.load()` publishes `loading` before its wire call and replaces it only from the call's `result`; a call that throws never produces one, and the composer seat swallows the rejection. The menu therefore showed a refresh that never ended — the same outcome any transport failure would have had.

The defect dates from the initial snapshot and stayed latent while every deployment shipped a default model, because `current` was then always present.

## Decision

The value schema accepts an absent `current`, matching the declared type and what the Host sends.

`ModelDirectory` routes both of its wire calls through one `settle` step that publishes `error`, with the failure's message, when a call throws instead of answering. The menu's existing error strip and **Retry** then say why the list did not load. A call that fails after a newer call replaced it, or after its session scope went, publishes nothing, so it cannot overwrite the state that superseded it. `select()` goes through the same step: a selection call that throws no longer leaves the menu busy.

## Alternatives considered

**Sending `current: null` from the Host.** It would satisfy the browser's schema without touching it, but it changes a wire contract the type already describes as optional, and it would leave the browser refusing any other client's absent field. The schema is what disagreed with the contract.

**Catching the rejection at the composer seat and setting an error there.** The seat is one of two consumers of the directory; the `/model` command reads the same store. The failure belongs to the operation that published `loading`, so it is published there.

## Consequences

A first-run composer now blocks with its stated reason — "This model is unavailable — select one to continue" — because the directory finally loads and reports the session's route as unservable. The input was editable before only because the directory never loaded; a prompt typed there could not have been sent.

Any future call failure in the model menu shows an error with **Retry** instead of an endless refresh.

The model-selection client files remain exempt from the per-file coverage gate as existing client-lane debt; the new branches are covered by the plugin spec regardless.

## Verification

`rpc-schemas.spec.ts` parses a `session.models` value with no `current`. The model-selection plugin spec covers a catalog call and a selection call that throw, a late failure superseded by a newer answer, and a failure after the session scope went. The web e2e for the subscription route runs in the first-run lane with no default model: it configures the route, sees the composer blocked with its reason, picks the model in the composer, and sees the composer unblock and the pick saved as the default.
