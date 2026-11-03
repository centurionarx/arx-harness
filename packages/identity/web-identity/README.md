# Native web identity contracts

This reference owns the `WebIdentity` and `IdentityAuthorityJournal` Service Definitions. The browser-safe `./contract` export contains detached DTOs, parsers, header/cookie names and the pure `allowsProjectAccess(principal, audience)` eligibility policy and `deriveAuthPresentation(state, pathname?)` graph projection. DTOs and these policies never establish authentication or ownership. The [identity subsystem reference](../../../docs/subsystems/identity.md) owns the generated API; [the decision record](../../../.agents/notes/implemented/architecture/2026-10-08-native-web-identity-journal-and-audience.md) owns rationale.

`AuthPresentation` selects public, administrative or USER composition and application/project scope before protected prefetch. Recovery entries remain public; role/audience mismatch yields no presentation. Its frozen fields contain no principal, token or content.

`RequestAuthority` is immutable and provider-issued; copies are refused. `revalidate` refuses a changed revision and absolute or idle expiry rather than updating an earlier grant. Its optional `{activity: true}` is a carrier decision after request admission; the provider durably renews only the idle deadline within the unchanged absolute limit. Passive validation omits this option. Carriers authenticate through `ctx.webIdentityApi.authenticateRequest(Request|IncomingMessage, {mutating})`, revalidate at final dispatch and check the specific owned resource. `audience` and `canonicalOrigin` are readonly deployment properties, never request selections.

Ownership is allocated by the control authority: a USER may have multiple projects, and each workspace/session inherits its project owner. Deleted ancestors deny descendants. Deletion leaves durable tombstones; grouping removal changes presentation without deleting ownership. MASTER_ADMIN cannot invoke ownership operations, impersonate, edit an established account email, change role, expose tokens or set a USER's final password.

The awaited `web-identity/invalidated` event joins credential/grant/status revocation with execution quiescence before its response. The awaited `web-identity/ownership-deleted` event cancels affected execution after the tombstone projection without revoking the valid login or changing its auth generation. The awaited `web-identity/session-expired` event targets one durable expired authentication session without changing the account revision or revoking other cookies. Its provider-owned timer does not depend on incoming traffic. The projection event lets independent companions compare journal and SQLite heads. A critical expiry failure closes admission and uses the existing disposal invalidation to attempt quiescence of all account consumers; it never claims an unprojected expiry was committed.

Public/admin composition contains identity and HTTP consumers only. Project content, provider credentials and execution belong to the separately isolated USER composition; see [the deployment proposal](../../../.agents/notes/proposed/architecture/2026-10-08-native-web-authority-and-owned-control-plane.md). These definitions expose no model tools and make no ambient current-user context. A model cannot bootstrap an account or acquire authority from a parsed DTO.

[The real Loader fixture](../../../examples/web-identity/README.md) composes native providers with synthetic secrets and external delivery replacements.

## Model Experience

### Shared identity contracts

#### What the model sees

`WebIdentity` and `IdentityAuthorityJournal` define HTTP identity and ownership. They register no prompt, tool schema or session message.

#### Token effect

Zero direct request-token effect. Model-facing consumers retain ownership of their existing messages and schemas.

#### KV Cache effect

This package contributes no model-visible request prefix or cache-key mutation.

## Known Limitations and Deferred Work

- An identity provider must implement the shared contract; a detached principal DTO never grants access.
