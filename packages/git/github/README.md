# @arx-ai/arx-github

Host-only Service Definition/Provider and authorization Consumer for read-only GitHub account and repository discovery. Injects existing credentials and authorization services; exports the GitHub Typert namespace with only `account({}, signal)` and `repositories({ page }, signal)`. [Public DTOs](src/types.ts) contain no credential values. No Agent or model session is consulted.

## Configuration

The operator selects `credential.mode`: `unconfigured` (default, healthy not-configured state and no PAT flow), `record` with key exactly `github/account`, or `ref` with an explicit POSIX credential reference. No ambient `GITHUB_TOKEN` fallback exists. Record mode uses provider record writability; a read-only record provider is visibly nonwritable and cannot accept a PAT. The existing record namespace has no environment layering: environment shadowing belongs to references. Ref mode never registers a PAT flow and is nonwritable through GitHub, including an environment-shadowed reference.

| Field | Default | Ceiling |
| --- | ---: | ---: |
| maxBytes | 262144 | 1048576 |
| maxItems | 100 | 100 |
| timeoutMs | 10000 | 60000 |
| pageSize | 30 | 100 |
| maxPages | 100 | 1000 |
| patBytes | 4096 | 4096 |

All bounds are positive safe integers; pageSize cannot exceed maxItems. Invalid configuration rejects without echoing input. Operator configuration carries selectors, never PAT values. The human submits a nonempty visible-ASCII, header-safe bounded PAT through the existing secret authorization prompt; the flow commits an api-key record through serialized `modifyRecord`. It does not verify the PAT with a network request before storage. The first account read reports invalid/revoked credentials as disconnected on 401 without deleting them.

## Reads and lifecycle

Only native-fetch GET requests to `https://api.github.com/user` and locally constructed `/user/repos` queries are issued, with fixed GitHub API-version/media headers and redirect refusal. Link URLs are ignored; nextPage is a local hint when a page is full and the configured page ceiling allows continuation. Responses must be HTTP 200 JSON, bounded streaming bytes, fatal UTF-8, and checked external fields; projected complete DTOs including wrapper and continuation are independently byte bounded. Repository ids must be positive safe integer external ids and are returned as branded strings. Unexpected fields are discarded; web URLs must equal locally derived GitHub URLs. Repository branches exclude ASCII control and DEL characters. Credential reflection in a projected DTO rejects.

Account reads report bodyless HTTP 401 responses as disconnected; HTTP 200 reads require a JSON stream. Cancellation listeners exist only for acquired readers; operation settlement joins stream cancellation and releases the reader even when cancellation rejects.

Credentials resolve on every operation. Timeouts cover the operation, with no retries. All operation failures use a fixed diagnostic without upstream body, headers, cause, or token. Cancellation is checked before queuing a record write and inside the exclusive callback; a completed provider commit is never rolled back. Disposal first withdraws the flow, aborts owned operations, and waits for their settlement. Providers and interaction surfaces must honor their existing lifecycle promises; this plugin cannot force an indefinitely blocked credential provider to settle.

## Security

Server-held credentials are not automatically model-visible: this package publishes no token DTO, token-taking Remote, or session event. This is not an operating-system access-control guarantee. A same-UID host process or coding agent can read credential stores; strong isolation is a separate deployment prerequisite. Do not accept real credentials in an agent-readable execution world merely because a prompt is masked.

## Verification

Run `node node_modules/vitest/vitest.mjs run packages/git/github/tests` from the repository root. Tests boot real Loader composition with the actual authorization service and a serialized in-memory credential provider; only external fetch responses are faked. No real PAT, credential store, login, or GitHub network request is needed.

## Model Experience

### GitHub Remote calls

#### What the model sees

Nothing from `github.account` or `github.repositories`: this package contributes no tools, prompts, or session events. Account and repository results are host UI data; any future model exposure requires a separately owned logged input.

#### Token effect

Zero direct token effect.

#### KV Cache effect

No model-request prefix or cache changes.

## Known Limitations and Deferred Work

- Only GitHub.com is supported. No OAuth, GitHub Enterprise, arbitrary URL fetch, credential selector RPC, cloning, staging, committing, or pushing is exposed. Human PAT privileges remain determined by GitHub; choose least-privilege read-only access. Generated client/API integration, assembled UI/transport and transcript proof, aggregate compiler registration, official build, family version bump, and external acceptance are owned by the parent integration, not demonstrated by this package's focused source tests.
