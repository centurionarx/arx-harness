# @arx-ai/arx-client-ui-settings-web

The **Web search** settings section: which registered search provider answers `web_search`, and the API key each one resolves through. The page is the browser half of the [web capability seam](../../web/web/README.md)'s configurable directory — it renders what `web.providers` reports and writes back through the wire, never holding a fact of its own.

## What the page shows

One row per search provider the host knows: its name, whether it is usable right now (its own `available()` answer), and — when its settings section names an `apiKeyEnv` — whether that credential is stored. A provider mounted without a settings section still appears and can be selected; it just carries no key control, because nothing says where its key would go. Above the rows, a select pins the provider the seam runs, or hands the choice back to the seam's rules; the line beneath it says which provider the next search would reach, or why none would — the same failure a search would throw, in words.

## Writes

The selection writes `searchProvider` in the `web` settings section (unpinning removes the field, so the seam's own rules take over again), fenced with the section revision the page last read so a document that moved underneath it is refused rather than overwritten. A key writes through `credentials.set` under the reference the provider's section names, and removing it is `credentials.unset`; the value crosses the wire once, inside that write, and never returns in any response. After either write the page reloads, and every pushed `settings/document-updated`, `credentials/reference-updated`, and `web/providers-updated` reloads it too, so a change made anywhere else converges here without polling.

## Model Experience

None, as the page changes only which provider `arx-tool-web` reaches and which key it resolves; the tool owns every model-visible effect.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Fetch providers are not configurable here** — the seam publishes a directory and a selection for search only; the fetch half follows when a second fetch provider needs configuring.
- **Only the key and the selection are edited** — a provider's other fields (endpoint, search mode, model) stay in the settings document or the composition; a per-provider card for them is deferred until a field needs a control the document does not already give.
- **No assembled-application snapshot yet** — the web e2e lane still stages the retired second locale, so this page's browser transcript is covered by unit and component specs until that lane is migrated.
