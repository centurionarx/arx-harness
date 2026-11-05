# Native web identity SQLite provider

This reference owns `ctx.webIdentity` persistence and authentication. Required config is an absolute `path`, private 32-byte `privateKeyPath` outside the database root, canonical HTTPS `recoveryOrigins.user/admin`, `bootstrapAccount.username/email` naming the MASTER_ADMIN account that `bootstrapMaster` creates, and a fixed operator-installed module catalog. Bootstrap identifiers follow the ordinary username and email rules; an invalid value fails at load with `AUTH_CONFIGURATION`. `allowInitialize` defaults to false; initialization is an explicit fixture/operator action. The identity database is independent of the history schema-17 database. [The identity definitions](../web-identity/README.md) own caller types and [the decision record](../../../.agents/notes/implemented/architecture/2026-10-08-native-web-identity-journal-and-audience.md) owns the tradeoffs.

Startup measures `sqlite_version()`, refuses uncorrected WAL-reset implementations, enables WAL/foreign keys/FULL synchronous mode, checks application/schema identity and compares the projection head with the current external journal. [SQLite documents correction in 3.51.3+ and the 3.44.6/3.50.7 backports](https://sqlite.org/wal.html#walresetbug). Database directory/file modes are 0700/0600. Database, key and journal placement require independently protected control storage; mode checks do not establish VM or multiuser isolation.

Mutation order is journal fsync and current-watermark publication, SQLite FULL transaction, awaited revocation or ownership quiescence, then ACK. The FIFO writer section ends at FULL projection; it releases before awaiting listeners that may depend on queued broker owner registrations. Queued admissions revalidate the committed revision and owner tombstones. The restore fence follows the same order. Provider disposal closes new admissions, drains started durable writes, then awaits quiescence before closing the database and clearing its key. A durable intent whose projection fails closes access until replay. Restore replays current credentials/status/grants/ownership/tombstones and invalidates every old cookie, bearer, invitation, reset and pending email. An operator must invoke `restoreFence()` for a restore at the same head. Missing/stale authority never creates a new genesis implicitly. [The journal provider](../identity-authority-journal/README.md) owns the external authority and writer recovery rules.

`registerSession(..., signal?)` checks caller cancellation before writer admission and again before journal append. An append already started completes FULL ownership projection, allowing the content consumer to finish its corresponding index even if the caller disconnects.

Passwords use asynchronous native scrypt N=131072, r=8, p=1 with random 16-byte salt and 32-byte output, an [OWASP-listed scrypt configuration](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Policy is 15–256 code points and at most 1024 UTF-8 bytes, with no normalization/truncation. Two hashes run concurrently; `hashQueueLimit` is bounded 0–64 (default 16), overflow returns 429, and queued cancellation removes the waiter. The provider rechecks cancellation, current credentials and single-use link state after hashing and before journal admission.

Sessions persist SHA-256 digests of random 256-bit reusable tokens, deployment audience and account revision. Invitation/reset links persist purpose-bound digests, TTL and atomic single use. An invitation establishes the recipient's password independently of status; reset cannot unblock an account or grant a module. Unknown/inactive login failures are generic and retain real password-hash work.

AES-256-GCM outbox payloads are durable only in SQLite, keyed outside DB backups and bound to their operation ID. The journal carries token digests and mail metadata without the raw token or encrypted link payload. Accepted/cancelled/used/expired payloads are cleared. One registered delivery provider retries every `deliveryRetryMs` (default 5000), within token TTL; cancellation wins over a late provider acceptance. [The Resend adapter](../web-identity-resend/README.md) owns external transport.

The absolute session TTL defaults to 8 hours; `sessionIdleTtlMs` is required and accepts 1000–86400000 milliseconds, with no production idle default. New and renewed idle deadlines are capped by the original absolute expiry. The fixture explicitly selects a 30-minute idle interval. Only a carrier mutation admitted after Host/Origin, credentials and applicable CSRF checks calls `revalidate(authority, {activity: true})`; session/status polling, WebSocket admission, worker progress, storage reads and ordinary revalidation never renew inactivity. Activity writes follow journal-fsync and SQLite FULL projection before admission returns. Both deadlines reject a session, and an expired session cannot renew itself. One provider-owned timer follows the nearest durable deadline even without new carrier traffic. Expiry appends and FULL-projects only that session as revoked, then awaits `web-identity/session-expired` listeners outside the writer queue. Other authentication sessions keep their account revision and deadlines. A later write failure still quiesces the FULL-projected prefix. Listener or background durability failure closes new admission and attempts unavailable-provider disposal for every account outside the writer queue, including uncommitted expiry work, without claiming it was FULL-projected. Disposal clears the timer and awaits this shared expiry and failure drain before closing SQLite. A failed drain remains unconfirmed and does not acknowledge success. Schema version 2 persists the idle deadline; version 1 is refused without an automatic migration. Invitation and reset TTL defaults remain 24 hours and 30 minutes; production budgets require explicit operational policy. There is no automatic purge. Quotas, retention, backup objectives and measured restore evidence belong to [the deployment proposal](../../../.agents/notes/proposed/architecture/2026-10-08-native-web-authority-and-owned-control-plane.md). Bootstrap is an operator-only idempotent method with mandatory first-password change; it is never an HTTP/RPC/model tool or literal config secret.

## Model Experience

### Private authentication state

#### What the model sees

`SqliteWebIdentity` manages users, sessions, tokens and administrative projections without registering model context. Password material and authentication tokens never become session messages.

#### Token effect

Zero direct request-token effect. Model-facing consumers retain ownership of their existing messages and schemas.

#### KV Cache effect

This package contributes no model-visible request prefix or cache-key mutation.

## Known Limitations and Deferred Work

- Initialization and MASTER bootstrap are explicit operator actions. Starting an ordinary provider cannot recreate a deleted administrator or replace current external authority.
