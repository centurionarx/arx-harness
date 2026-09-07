# @arx-ai/arx-web-search-exa

An [Exa](https://exa.ai)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls Exa's `POST /search` endpoint with highlight contents and maps the flat `results[]` into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@arx-ai/arx-tool-web`). Like `@arx-ai/arx-llm-pi-ai`, it is a function/namespace plugin (`inject: ['web']`) that registers its backend, not a default-export service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | (unset) | Exa API key inlined in the composition. Set, it wins over every other source; unset, the key resolves through `apiKeyEnv`. |
| `apiKeyEnv` | `EXA_API_KEY` | Credential reference the key resolves through: the managed credential store first, then every launch-environment layer. An empty result makes the provider unavailable. |
| `baseURL` | `https://api.exa.ai` | Endpoint base; `/search` is appended. An unparseable value makes the provider unavailable. |
| `searchType` | `auto` | Retrieval mode sent as Exa's `type`: `auto` (Exa decides), `keyword`, or `neural`. |
| `numResults` | (unset) | Default result count when a request carries no `maxResults`. Unset sends no default. Must be a positive integer. |
| `highlightsPerResult` | `1` | Highlight sentences requested per result (Exa's `highlightsPerUrl`). Must be a positive integer. |

```yaml
- id: web-search-exa
  name: '@arx-ai/arx-web-search-exa'
  config:
    apiKey: !!js process.env.EXA_API_KEY
```

The same keys are the runtime-editable `web-search-exa` settings section: a settings document overrides any of them, and the provider reads its options at every search, so a committed change is in force at the next call without re-registering. The key never rides the section — a configuration surface writes it through the credentials domain under `apiKeyEnv`, and the provider re-reads the managed store when that reference changes. The plugin also declares the provider in `ctx.web`'s configurable directory (`provider: exa`, this namespace, an empty path), which is how a configuration surface finds where its profile lives.

## Mapping

Exa returns a flat `results[]` and no generated answer, so `content` is omitted. Each result maps to a `WebSearchSource`: `url` ← `url`, `title` ← `title`, `snippet` ← the first non-empty `highlights[]` entry (a result with no highlight has no portable snippet and is dropped), `publishedAt` ← `publishedDate`. A request's `maxResults` wins over the configured `numResults` default and is sent as Exa's `numResults` for a cost/latency optimization; the final bound is enforced by the seam. Provider failures (HTTP errors, network failure, unparseable or wrong-shape bodies) surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`arx-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, first highlights, and publication dates or its exact `Exa search aborted`, `Exa search request failed: <error>`, and `Exa returned an unprocessable response body: <error>` failures under the consumer's error wrapper while generated answers and provider-private fields remain outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **A result with no non-blank highlight is dropped entirely** — no portable snippet to map, so fewer sources than the requested count can return.
- **Only `searchType`/`numResults`/`highlightsPerResult` are exposed** — Exa's other controls (livecrawl, category, domain/date filters, full-text contents) wait on provider-neutral Service Definition fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (e.g. `arx-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
