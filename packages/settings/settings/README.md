# @arx-ai/arx-settings

User-settings Service Definition (`ctx.settings`). One provider holds a raw document of per-namespace sections; plugins register a namespace schema and read a resolved value layered as schema defaults, then the registrant's composition `base` (its cordis.yml entry-config subset), then the user document section. Without a mounted provider nothing changes for consumers: they keep resolving entry config alone, so every composition works with or without settings.

## Service API

- `documentPath` — absolute path of the provider's user-editable file when it has one; non-file providers leave it `undefined`. Host configuration adapters derive availability from it, while browser protocols expose only a boolean capability and never a filesystem target.
- `prepareDocument()` — return that path after making the document ready for a native editor. The base implementation returns `documentPath`; a file provider may materialize an absent document first.
- `register(ns, schema, { base?, applies? })` — returns the owner `SettingsScope` (`get`/`watch`/`update`). The registration is an effect on the calling plugin's fiber: disposing that fiber removes the namespace and its observers. A stored section the schema rejects fails the registration itself; a duplicate namespace fails loud.
- `describe(options?)` — one descriptor per namespace (Schemastery uid/refs envelope, resolved value, detached `base`/`user` layers, `applies`); a field's presence in `user` marks it user-overridden. Every wire consumer MUST use `describe({ redactSecrets: true })`, which projects every data layer, sanitizes schema defaults and adds the `secrets` slot list (`{ path, set }`). See [wire redaction](#wire-redaction) for supported schemas and failure semantics.
- `get(ns)` — resolved value, `undefined` while unregistered.
- `update(ns, patch)` — deep-merges the plain-object patch into the user section only (never the `base`), validates the resolved candidate, persists through the provider, then commits. Patches may contain only JSON-compatible data: a Date, Map, BigInt, non-finite number, or circular reference rejects with its `$`-rooted path before anything persists (YAML/JSON storage would silently change such values on reload). Validation failure rejects before anything is persisted; a read-only provider (`writable: false`) rejects every write. Writes to one namespace are serialized in call order.
- `replace(ns, section)` — sets the user section wholesale: the deliberate reset (`replace({})` re-inherits `base` and schema defaults).
- `mutate(ns, ops)` — applies ordered `{ op: 'set' | 'unset', path }` edits to the section as it stands when the write reaches the front of the queue. This is the removal path for any caller holding an INCOMPLETE view: a configuration UI reads the redacted descriptor, so rebuilding a section from it and replacing wholesale deletes every secret the wire never returned, while an op names the one field it means.
- Every write takes an optional `expectedRevision`. Each descriptor carries the namespace's `revision`, a monotonic counter over its RAW section; a write whose expectation no longer matches rejects with `SettingsConflictError` (`code: 'SETTINGS_CONFLICT'`, both revisions attached) instead of overwriting the writer that landed first. The write queue orders writes but cannot by itself tell a fresh writer from one holding a stale snapshot.
- Resolved values are deep-frozen snapshots. Watchers receive `(next, prev)` after each commit: invocations of one callback run asynchronously, one at a time, in commit order (a slow stale invocation can never apply after a newer one), and failures — sync throws and async rejections alike — are contained. After a watch disposer returns, no further invocation starts (one already queued is skipped); an invocation already started still settles. The `settings/updated` event fans out one listener at a time, so one throwing listener cannot starve the rest; an async listener's rejection is contained and logged, which is why `INVARIANT`-coded failures rethrow only from synchronous listeners.
- Service teardown refuses new writes and watcher starts, then drains every queued write and every started watcher invocation before disposal completes; a write whose registrant fiber was disposed mid-flight still reaches storage but commits and notifies nobody.

## Wire redaction

Redaction accepts primitive strings, finite numbers, booleans, scalar constants, nullable values, objects, dictionaries, arrays and secret-free unions of these schemas. Shared schema references are supported. Unknown object keys are omitted rather than copied, and returned containers are detached. A node marked `role('secret')` is opaque: its value is removed and its serialized schema becomes a write-only string with no default or executable relations. Object-property secret slots are reported even when unset; dictionary and array slots exist only for present entries.

The complete schema graph is checked on each redacted read, including absent fields and empty containers. Unmarked `any`, transforms, intersections, lazy/recursive schemas, object-valued constants, unknown node types and unions containing secret branches reject instead of returning uncertain data. Wrap an opaque sensitive subtree in `role('secret')`, or describe its data with supported nodes. Unsupported metadata, cyclic data and incompatible field values also reject without quoting input. Serialization applies the same projection to defaults at every schema node, including container defaults; it never calls schema callbacks or `toJSON()`.

The API proxy checks redaction before executing each wire write, even without a preceding describe request, and sanitizes successful write responses. Arbitrary schema, owner-validator and persistence errors become value-free wire diagnostics; revision conflicts, unknown namespaces and read-only status retain dedicated safe messages. Stored-section and observer warnings omit exception contents. Same-process `get()` and unredacted `describe()` remain privileged reads; schema authors must mark sensitive values explicitly and keep credentials out of descriptive metadata and dictionary keys.

## Provider contract

Subclasses implement `writable`, `load()`, and `persist(ns, section)`, optionally override `documentPath` and `prepareDocument()` for one local user-editable file, and push externally observed documents through the protected `publish(doc)`. The base service init loads and publishes the document once before the service becomes injectable; a provider with its own init (watcher, connection) delegates first via `yield* super[Service.init]()`. At publish, each registered namespace re-resolves independently: an invalid section keeps that namespace's last good value and warns — a live reload never takes the process down — while boot-time and registration-time validation fail loud.

## Events

`settings/updated (ns, next, prev, source)` fires after each commit; `source` is `update` (in-process write) or `provider` (external change). It never fires for a deep-equal resolved value — it is the consumer-facing event, and a consumer only cares that its value moved.

`settings/document-updated (ns, revision)` fires whenever the RAW user section changes, whether or not the resolved value did. Configuration surfaces need this one: storing an override equal to the composition base leaves the resolved value alone but changes what the document says (the field is now overridden, not inherited) and moves the revision every open editor is holding. Listener containment matches `settings/updated`.

Both declarations live in the client-safe `./types` subpath export, together with the `SettingsNamespace` and `SettingsUpdateSource` types their signatures name; the package root re-exports those types. A consumer outside the Host compilation face therefore reads the very signature the Host emits instead of restating it.

## Model Experience

Indirectly, through consumer plugins that resolve model-affecting values (for example a default model route) from their namespaces; each consumer's own surface documents the effect.

#### KV Cache effect

No direct invalidation; a consumer that folds a settings value into the request prefix owns that change.

## Known Limitations and Deferred Work

- **Single user layer** — resolution knows schema defaults, one composition `base`, and one user document; it does not yet record which layer supplied each resolved value.
- **Unsupported wire schemas refuse the complete descriptor request** — settings consumers can still use them in-process, but the wire editor requires supported schemas or opaque secret subtrees. A malformed stored field may require repair through the local document rather than the wire editor. Redaction cannot identify an unmarked credential in a plain string field, such as a provider header.
- **Cross-process concurrency is provider-defined** — the seam serializes writes per namespace in-process only; concurrent processes converge by provider behavior (the local file provider read-modify-writes under a writer lock, so namespaces survive concurrent writers and same-namespace conflicts resolve last-write-wins).
