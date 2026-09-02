# Agent Note: the OpenAI-compatible provider preset

Status: implemented

## Problem

The models settings section offered two ways to gain a provider: adopt one the adapter already knows, or open the fully blank custom card and declare route, display name, protocol, endpoint, key, and models by hand. Users pointing at OpenAI-compatible gateways — vLLM, Ollama, OpenRouter, LM Studio — had to know that the wire protocol is called `openai-completions` and that the derived credential reference comes from the route id, before any of their fields could succeed.

## Decision

A third entry point joins the row: **Add OpenAI compatible**. It opens the same `CustomProviderCard` with a `preset` — route `openai-compatible`, display name `OpenAI Compatible`, protocol `openai-completions` — and leaves exactly the three fields a preset cannot know empty: endpoint, API key, and the model list.

The preset is a draft, not a different flow. Every field stays editable, the card's validation and the derived `OPENAI_COMPATIBLE_API_KEY` credential reference work exactly as the blank card's, and a user who already declared a route named `openai-compatible` simply sees the taken-route refusal rather than a second, shadowing declaration. When a preset names a protocol the adapter's schema union does not offer, the card falls back to the adapter's own first choice rather than drafting a select value nothing can submit.

The section tracks which entry point is open (`declaring: false | 'custom' | 'openai-compatible'`) and passes `preset` accordingly, so closing either editor still discards both drafts as before.

## Alternatives considered

**A dedicated OpenAI-compatible card with its own form.** Rejected: it would fork the card's validation, capacity sizing, model-row mechanics, and conflict handling into a second component whose only difference is the starting text. The preset keeps one write path under one set of gates.

**Detecting the gateway from a pasted endpoint.** Rejected: a base URL disclosing nothing about the wire protocol behind it is normal (proxies resell many shapes), and silent reclassification of a pasted URL is the kind of magic a settings screen must not do.

**Prefilling the model list by fetching `/models` with no key.** Rejected: gateways differ on serving listings unauthenticated, and the theme of the card is that failing fields are named at the moment of writing. The endpoint, key, and models remain the user's three fields.

## Consequences

An OpenAI-compatible gateway needs its endpoint, key, and model ids and nothing else: the naming that previously had to be learned (route conventions, protocol vocabulary) is drafted. One preset ships today; the mechanism is generic, so another endpoint family becomes a fourth button and a constant.
