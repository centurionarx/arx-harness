# Agent Note: Protected Instructions control and isolated execution

Status: proposed

## Problem

The Settings Instructions record must be mutable only by an authenticated operator, across projects, sessions and managed model routes. An unrestricted agent sharing the control process user can modify its files, writer, deployment and request assembler or invoke its local APIs. Existing loopback checks and private interaction ids do not authenticate a human.

## Proposal

Deploy reviewed Node/Cordis control, protected records, durable authority and request assembly on a fresh operator-owned trusted VM. The current VM and checkout are untrusted development/execution inputs, not a trusted deployment source; this VM may become the dedicated worker after operator-controlled cutover removes its control authority. The worker VM receives workspace data and bounded execution capabilities, not control source, deployment credentials, provider secrets, operator sessions, host sockets or an authenticated browser profile. The worker network policy excludes control, management and metadata targets, including alternate IPv6, DNS, redirect and tunnel paths. Merely naming a VM or container is not enforcement.

The current same-UID development session cannot install its own trustworthy boundary. An operator provisions and cuts over the reviewed deployment from an independent control channel. No infrastructure change, account configuration, credential migration or service restart is authorized by this proposal.

A dedicated HTTPS operator origin serves only reviewed UI code and owns the Instructions writer. Operator authentication, server-side sessions, secure cookie policy, CSRF checks, strict browser-origin checks and exact expected revisions govern commits. OIDC is the recommended authentication integration, subject to operator selection. The worker API cannot proxy this writer or generic host administration, and approval correlation ids confer no writer authority. Model-loaded client code cannot run in the operator origin.

Project exceptions are separate human-committed records bound to canonical workspace identity, the applicable global revision/hash and the exact approved deviation. Exception changes leave the global record unchanged. Exception commit and revoke use their own expected revision and atomically validate canonical workspace identity, global revision and current exception revision. A global revision invalidates stale exceptions until human reauthorization. Each request atomically selects a committed global/exception snapshot at its logged dispatch cut; already-dispatched requests retain that snapshot, while the next request must use current authority. Revocation prevents future use, not retroactive alteration of a dispatched request. Workspace guidance, local overlays and worker-supplied labels never confer exception authority.

Extend [agent-instructions](../../../../packages/context/agent-instructions/README.md), not the core loop or a parallel prompt engine. Resolve a protected snapshot before filesystem, cache or pending-message shortcuts. Log exact included text, original/included byte counts, global revision, full-content digest and exception provenance at each request cut. Reserve the global budget before workspace guidance and refuse requests that cannot include the required source. Resume, fork and compaction reconcile current authority instead of reviving old grants. Prose remains below system/developer authority and cannot guarantee model obedience.

Record protection and request injection are distinct acceptance claims. A trusted final request gate immediately before managed provider dispatch resolves and validates the canonical snapshot, checks the complete actual request budget and logs the exact applied bytes, including exception revision. Managed provider credentials and alternate endpoint selection remain exclusively in control; a worker cannot bypass this check through an authenticated passthrough. [Claude Code](../../../../packages/subagent/subagent-claude-code/README.md#capabilities-and-context) and [Codex](../../../../packages/subagent/subagent-codex/README.md#capabilities-and-context) do not inherit parent context; they need explicit logged adapters and a proven update strategy for external requests. Unsupported routes remain disabled for protected sessions. A launch manifest alone does not prove every later request receives current guidance.

## Execution inventory

Relocate execution through existing provider interfaces: filesystem/subprocess, CodeRuntime, WorkflowEngine, terminals/LSP, arbitrary URL fetching, MCP transports, native provider processes and SDK child launches. Direct SDK/MCP spawns are not covered by swapping the subprocess provider. Explicitly relocate [skill-git materialization](../../../../packages/skill/skill-git/src/index.ts) and [native-command execution](../../../../packages/util/native-command/src/runner.ts) to the guest for model-owned work. Disable [open-in-app detached host launch](../../../../packages/host/open-in-app/src/resolver.ts) on worker routes; any retained operator launch requires separate human authorization and is outside worker cancellation claims. No retained trusted operation may execute guest-controlled workspace or configuration. Trusted dispatchers retain bounded ownership, cancellation and logging; no worker callback obtains a Cordis resolver or arbitrary host fetch/spawn capability. Self-modification may edit the guest checkout but cannot mount guest code in control or its operator UI. Cold resumes and alternate subagent/workflow paths must not restore an unconfined provider.

## Delivery phases

1. Approve target VM placement, resource/cost limits, operator identity provider and the complete execution inventory. Produce failing authority/isolation tests before enabling a writer.
2. Implement and review bounded VM adapters in a disposable deployment; keep the protected writer disabled. No ambient host fallback is permitted.
3. Implement operator commits, exception records, snapshot lifecycle and route-specific adapters; verify all managed request paths and budget cuts.
4. Obtain independent security review and explicit cutover approval. Restart the existing managed GUI only from an independent operator channel and verify its actual URL, roster and version. Rollback is operator-owned, not an agent-accessible unconfined fallback.

## Alternatives considered

**Same-UID files, hidden controls or loopback checks.** Rejected because the present agent can reach both storage and execution authority.

**Hardened same-host container.** A possible deployment, but not the recommended initial target: shared-kernel isolation requires independently enforced mounts, namespaces, capabilities, devices, sockets and egress constraints. Ordinary container defaults do not meet this threat model.

**Move filesystem and subprocess only.** Rejected because Code Mode, workflow workers, SDK/MCP direct spawns, self-modification and browser/network execution provide alternate host paths.

**Protect storage without validating request assembly.** It can protect the record, but cannot establish universal managed guidance while an unrestricted worker owns request assembly or provider credentials.

The [workspace-context decision](../../implemented/feature/2026-06-24-workspace-context.md), [local overlays](../../implemented/feature/2026-07-21-local-instruction-overlay.md) and [symlink behavior](../../implemented/feature/2026-07-21-follow-instruction-symlinks.md) retain their workspace-loading rationale. This proposal introduces separate protected authority and does not supersede their current implementation.

## Acceptance criteria

- Guest root, escaped language runtimes and direct file/process/socket access cannot read operator credentials or change protected control state. Resource exhaustion cannot publish a commit.
- Guest network/browser/MCP/fetch requests cannot reach the writer, operator browser or management plane; host proxies cannot act as confused deputies.
- Only authenticated, CSRF-safe, exact-revision operator commits alter globals. Raw HTTP/WS/Typert/SDK/ACP, generic settings, forged approvals and replayed interactions cannot bypass the writer.
- Exception commit/revoke preserves global text/revision/hash; wrong workspace, stale revision and inherited grants fail closed.
- All model-owned execution, delegated and resumed paths remain VM-bound and disposal reaches process-tree quiescence.
- Real request/log evidence proves current exact snapshots across edits, races, resume, fork, compaction and provider changes. Tiny, exact and multibyte budgets cannot silently omit globals or authorize an omitted exception.

## Risks

The VM and authenticated control deployment require operator-managed infrastructure and costs not yet specified. Full network isolation must preserve explicitly approved business access without exposing control. External provider refresh may require cancellation/relaunch or remain unsupported. This proposal guarantees neither perfect model obedience nor security against compromise of the trusted control host, operator credentials, hypervisor or administration plane.
