# Isolated project runtime

Reference for the `isolatedProjectRuntime` provider.

The adapter carries existing ApiProxy requests and event frames to an operator-configured supervisor. It refuses execution without an endpoint and has no local host fallback. Anonymous, restricted first-password, MASTER-ADMIN, blocked and stale authorities cannot dispatch project work.

## Configuration

`endpoint` is a credential-free HTTPS origin, configured together with `credentialRef`. The adapter resolves only that reference through the existing credential provider for each operation. Browser cookies, bearer credentials and Origin headers are excluded from worker requests. `fixtureLoopback` permits HTTP only for an explicitly configured disposable loopback fixture.

`requestTimeoutMs`, `cancellationTimeoutMs`, `maxRequestBytes` and `maxResponseBytes` are required. Unary responses and individual SSE frames obey the response byte limit. Redirects are refused.

## Authority and protocol

Every admitted payload uses the same browser-safe method schema registry as the existing ApiProxy fetch boundary. Invalid method payloads return the existing `bad-request` business receipt before dispatch; unknown payload fields are refused in the authenticated profile. The fixed request allowlist excludes control-plane settings, credentials, native dialogs, host exit and arbitrary preset installation. Resource references are checked against the authoritative identity sidecar. Creation requires an owned workspace and a control-generated session id; caller cwd, path and preset fields cannot select a host execution context.

The exact server-owned method policy separates active mutations from queries. Automatic `host.describe`, session listing/history, subagent refetch, reconnect, read-only Remotes and event streams do not renew idle even when their transport uses authenticated POST. `session.create` with an existing owned session id is a passive resume; creation without a session id is eligible only after the control-issued allocation and matching worker receipt. A successful active RPC still requires current authority, grant, owner references and an unexpired lease before renewal and again after its durable activity commit. Worker progress, model/tool callbacks and broker persistence do not renew the user session.

A new `session.create` keeps registration lazy until the worker opens the new session and returns the matching allocation receipt. Control then durably commits its canonical empty header before external success or idle renewal. The history is immediately readable with sequence zero and no invented events. Commit failure, cancellation or runtime shutdown rejects success; an admitted write still finishes. Existing-session resume preserves its original lifecycle.

Before live Agent creation, the trusted worker resolves the already allocated header through the closed, read-only `creation-header` broker operation. Control returns only current owned index metadata after storage-grant, owner and lease revalidation; it reads no log and materializes no artifact. The worker validates the assigned id, workspace cwd, preset and format version and uses the control creation timestamp. Browser payloads cannot provide that metadata. Cancellation and revocation refuse its receipt, and this passive read never renews idle.

Canonical Typert business results keep their existing codecs. `commands/execute` renews only for its `result.kind: success`; unresolved commands and command errors remain passive. Feedback mutations require their inner `ok: true`, so compare-and-set and validation refusals cannot renew through an outer RPC success. A correlated `/api/respond` renews only after `accepted: true` while its original pending lease remains valid, and only the responding authentication session is renewed.

Worker requests carry an opaque operation id, owner user id, security revision and selected project/workspace ids. The final authority check occurs after credential resolution and before fetch. Supervisor responses echo `x-arx-operation-id`; `x-arx-quiescent: true` releases a finished lease. A background operation retains its lease until supervisor cancellation.

Cancellation posts to `/_arx/operations/{id}/cancel` and requires a matching operation id with `quiescent: true`. Revocation listeners are asynchronous and reach quiescence before the identity mutation acknowledges. Resource deletion uses its separate ownership-deleted event, also awaiting cancellation before ACK while preserving the authentication cookie and security revision. A missing receipt closes the adapter. Process interruption never triggers automatic replay of external work.

The existing SSE carrier parses mux and host frames. Owner references are verified before emission, foreign aggregate rows are filtered, and generic remote host events are refused. Logout, security revision changes and disposal abort transports and cancel retained supervisor leases.

The private worker-history RPC has a closed `list-snapshots` operation. Control observes one actual provider metadata scan, filters every session through current owner/workspace membership and revalidates authority before returning headers and source-qualified revisions. Worker `list` and `listSnapshots` consume that receipt without per-session global scans. Individual snapshot reads retain complete event validation and before/after `readRevision` checks. Index rows never supply revision tokens.

## Model Experience

### Existing isolated agent execution

#### What the model sees

The adapter contributes no system prompt or tool schema. Its `session.prompt` carrier preserves the existing worker composition, model routes, tools and logged session events.

#### Token effect

Zero direct request-token effect.

#### KV Cache effect

The carrier adds no model-visible prefix and preserves the existing worker composition's cache behavior.

## Known Limitations and Deferred Work

- HTTP fixtures prove request ownership, response filtering and cancellation of disposable child processes. They do not prove distinct VM/UID, filesystem mounts or network isolation.
- The trusted supervisor must isolate worker filesystem, processes and egress and keep its credential outside untrusted code. Internet activation requires verified supervisor deployment.
- Arbitrary host-path workspace creation and control-plane API methods are unavailable in authenticated project mode.

- `session.fork` requires the worker persistence broker to allocate and register the child id in the control domain before worker effects. A composition without that broker fails closed; local fork payloads remain unchanged.
- The worker-to-control broker requires a separately deployed trusted supervisor, isolated worker allocation and protected broker credentials. Disposable provider compositions verify the protocol but do not establish production isolation or activation.
