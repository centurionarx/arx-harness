# Native identity HTTP consumer

This reference owns `ctx.webIdentityApi`, shared by HTTP/RPC/WS carriers through `authenticateRequest(Request|IncomingMessage, {mutating?: boolean})`. Readonly `audience` and `canonicalOrigin` come exclusively from deployment config. Existing Host/Origin reachability guards remain. An original Host, when present, must equal canonical authority; a Fetch Request without that header uses its own URL authority. Origin and forwarded headers never establish Host trust. The exact HTTPS scheme/origin check adds account admission to the [existing browser trust rule](../../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.md).

Auth routes expose session, login/logout, mandatory password change, generic recovery and invitation acceptance. Admin routes expose USER listing/creation/status/module grants and pending invitation management. Administration deployments register a refusal for the USER namespace: the existing Host/Origin, authentication and mutation CSRF fences run before a fixed 403, without mounting owner storage or a project runtime. There is no public registration, active email/role/final password edit, reset recipient override or generic project/RPC/WS tool. [The identity definitions](../../identity/web-identity/README.md) own DTOs and issued authority; [the SQLite provider](../../identity/web-identity-sqlite/README.md) owns credential mutation.

Audience cookies are separate `__Host-arx-user` and `__Host-arx-admin`, Secure, HttpOnly, SameSite=Strict, Path=/, without Domain. Browser mutations require same origin, JSON and `X-Arx-Auth: 1`; authenticated cookie mutations also require `X-Arx-CSRF`. Bearer use defaults off and requires explicit non-browser operator configuration. `authenticateRequest` enforces those request fences without renewing idle, including for SDK queries transported by POST. Only the exact successful administrative create/status/module/invitation/email actions renew the provider-owned idle deadline after semantic admission, awaiting journal-fsync and SQLite FULL activity publication. Current authority, connection cancellation and provider lifetime are checked again after that await. GET, HEAD, session/invalidation polling, WebSocket admission and refused or malformed actions remain passive. Login and password/recovery/invitation flows create or rotate their own session; logout revokes its session. The absolute deadline never moves. The provider expiry event settles only long polls belonging to the expired authentication session; other sessions retain their pending checks. A LoginResult token stays internal and becomes Set-Cookie; AuthState and query strings never carry it.

`GET /auth/invalidation?generation=N` is a bounded auth-only long poll (default 25 seconds, maximum 30 seconds, default two pending requests/session). It remains available during mandatory password change and is independent of project WS. Revocation/disposal settles and cleans waiters exactly once. Every state includes deployment audience, including anonymous state. SESSION maps invalid credentials to anonymous 200; ambiguous credentials and other typed failures keep their 400/403/503 status.

Body and rate admission are bounded. Socket IP is used without trusting arbitrary X-Forwarded-For, and identifiers are digested for their separate TTL limiter. Cancelled connections propagate abort to native password work before mutation admission. Failures use fixed text without submitted identifier/password/token; responses use no-store/no-referrer/nosniff.

This consumer exposes no model tools. `allowInsecureLoopbackFixture` is a test flag, not TLS evidence. The [keyless fixture](../../../examples/web-identity/README.md) exercises actual Node HTTP and Fetch Request carriers, while [the deployment proposal](../../../.agents/notes/proposed/architecture/2026-10-08-native-web-authority-and-owned-control-plane.md) owns public cutover requirements.

## Model Experience

### Authenticated HTTP entrypoints

#### What the model sees

`WebIdentityApi` authenticates HTTP carriers and administrative mutations. Cookie, CSRF and recovery data are not model context.

#### Token effect

Zero direct request-token effect. Model-facing consumers retain ownership of their existing messages and schemas.

#### KV Cache effect

This package contributes no model-visible request prefix or cache-key mutation.

## Known Limitations and Deferred Work

- Server-owned activity eligibility is separate from CSRF admission. It is enforced by each semantic consumer; an authenticated mutation flag or client-supplied activity field cannot authorize renewal. Focused source proofs do not replace browser, performance, deployment or package-install gates.
- Internet use requires a verified canonical HTTPS origin and protected control-plane deployment. Forwarded client headers do not establish the request origin or client authority.
