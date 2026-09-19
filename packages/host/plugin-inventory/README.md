# @arx-ai/arx-host-plugin-inventory

Read-only Host projection of the current Cordis Loader tree. `PluginInventoryGateway` registers the `pluginInventory` service and publishes one generated direct Remote, `pluginInventory/list`. Every call reads `ctx.loader.entries()` directly, skips structural group rows, and returns the remaining entries in Loader order with only their Loader entry id, module specifier, effective enablement, and current root Fiber phase. When `@arx-ai/arx-agent-presets` is composed, the same snapshot also contains one group per discovered preset with its id, name, trust, default marker, health, and flattened composition rows.

Preset rows expose module identity, effective enablement, condition text, and live Fiber phase. They never include plugin configuration values or the filesystem diagnostic behind a broken preset. A mounted preset reports its evaluated Loader state; an unmounted preset is parsed with the Loader's own expression evaluator, so conditional rows remain distinguishable from disabled rows without mounting an Agent.

The phase is `pending`, `loading`, `active`, `failed`, or `unloading`; it is `null` when the entry has no live root Fiber. The snapshot is intentionally point-in-time: Loader remains the sole lifecycle authority, while this package owns no cache, history, provenance model, event stream, or mutation path. Its public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

## Model Experience

None, as this Host-only inventory projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time state only** — the result contains no durable failure history or subscription; a missing root Fiber is reported as `null`, regardless of why no live root exists.
- **No mutation** — the service cannot enable, disable, add, or remove plugins. Preset trust and identity identify the composition source class, not package provenance or an authorization boundary.
