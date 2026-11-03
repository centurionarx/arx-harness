# Native web identity UI

The plugin presents public identity flows, MASTER user/module administration, and USER account plus owner project/workspace/history navigation. It runs only in authenticated composition. It uses the browser-safe web-identity and project-storage contracts; there is no second DTO/schema authority, public signup, project impersonation, or local-path provisioning.

Cookies remain HttpOnly. CSRF and single-use recovery fragments stay in private boot memory, and the first native inline script removes fragments before any bundle; the client consumes the one-use callback transfer before the auth session GET. Auth invalidation or logout ends the whole Context, cancels body reads and script factories, and clears previous-principal view/cache/history state. Cross-tab messages contain no token.

Logout retracts all tabs immediately and transfers the same channel to a neutral completion handle. Only the matching HTTP acknowledgement permits a fresh navigation; delayed or duplicate acknowledgements cannot revive an old tree. A persisted negative guard contains only origin, audience, generation, and operation id. After fresh session/HTML verification, a matching guard prevents private factories even after reload. A validated anonymous session, genuinely changed generation, exact active acknowledgement, or confirmed explicit login clears it. Public recovery/login uses the existing recovery composition and never inherits private services. Both auth cleanup and the slot-store purger preserve the exact denial key. The client disposes its bootstrap lifetime before notifying the kernel boundary, so a tree abort cannot release the completion prematurely. A failing subscriber cannot prevent other subscribers or the boundary; a synchronous boundary failure also disposes the completion and contains the detached logout request.

In a document originally served at `/reset` or `/invite`, the same publisher captures each current recovery hash before downstream hashchange/popstate taps. It strips only the current URL; older history entries are captured as new navigation when revisited. Each capture removes the previous form synchronously, clears drafts/capabilities, and reads the real session again. A private kernel validator retains the original pathname, marker, and manifest; user, audience, generation, or session-CSRF divergence closes the tree. Matching captures reuse the public composition with an ephemeral form revision. A POST takes its capability once before awaiting HTTP. Checking and ready notifications attempt every subscriber. A failed consumer closes the tree as unavailable before validation or polling can continue from that notification. Neither same-document recovery nor its observable creates another module system or identity authority.

USER metadata and history remain available without the runtime grant through a neutral application tree. Workspace execution, resume, and branch require genuine project runtime services. Default history omits its technical session header; the explicit owner-only JSONL export preserves original bytes and may include paths from that owner's volume. Removing grouping does not delete files or log artifacts.

Source HTTP and built browser fixtures use real identity, journal, Loader, owner storage, and request-rendered HTML. Only disposable external email/model providers may be substituted. The [application composition proposal](../../../.agents/notes/proposed/architecture/2026-10-08-native-application-slots-and-boot-lifetime.md) records the framework changes and outstanding operational acceptance.

## Model Experience

### Identity and owner navigation

#### What the model sees

Nothing added by `BrowserAuthClient` or the identity forms. These components render identity metadata and existing owned history in the browser; they register no model prompt, tool definition, model-visible schema, or new conversation content. Genuine project runtime consumers own model request assembly.

#### Token effect

Zero additional model-input tokens. Login, recovery, administration, account changes, metadata navigation, and viewing or exporting stored history do not submit a model request.

#### KV Cache effect

None. Identity transitions dispose the client tree but do not rewrite a provider request prefix, schema order, or conversation messages.

## Known Limitations and Deferred Work

- USER execution, resume, and branching require the runtime grant and a configured isolated worker. Metadata navigation stays in the application tree without that grant; unavailable execution fails closed.
- Quotas and retention policies require deployment decisions. The UI displays server quota failures and provides owner export/delete, but defines no numeric allowance or automatic retention.
- Native GitHub settings remain unavailable until their configuration and RPC calls have an approved owner-safe service. Existing local configuration remains in the legacy composition.
- If browser storage is unavailable, private admission remains closed and the page explains that cross-document persistence cannot be guaranteed. Storage carries denial metadata only; it never carries credentials or grants.
- Complete built-browser acceptance for the USER project graph, event streams, recovery links, and malicious preview remains pending. Fixture HTTP success does not prove VM UID, mount, or network isolation.
