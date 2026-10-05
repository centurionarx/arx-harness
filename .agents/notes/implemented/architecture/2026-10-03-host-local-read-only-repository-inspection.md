# Agent Note: Host-local read-only repository inspection

Status: implemented

## Problem

The sidebar needs registered-workspace Git identity, independent staged and worktree changes, and exact comparisons without starting an Agent or granting callers arbitrary subprocess arguments. Git configuration, attributes, metadata links, and object alternates can execute commands or read outside the selected workspace even when external diff and textconv are disabled.

## Decision

The [repository BFF](../../../../packages/git/repository/README.md) owns managed Git operations against concrete host-local filesystem and subprocess providers. A registered workspace must contain an ordinary .git directory. Provider identity and filesystem checks precede Git; metadata links, includes, alternates, worktree indirections, partial clones and executable or unresolved attribute filters are unsupported. Local-only config queries and scrubbed execution environment prevent ambient configuration from expanding the supported operations. Git parses its binary database formats; concurrent filesystem replacement is not a confinement guarantee.

The [repository sidebar](../../../../packages/client/ui-repository/README.md) occupies its owner-declared seat independently of the session browser. Viewing selection belongs to its entry store; its private React-free controller owns observable facts, cancellation and disposal. Generated Remote methods carry registered workspace ids and current status paths, not filesystem roots. Native HTML dialog modality provides background inertness; local edge handling keeps unmodified keyboard traversal on its owned controls.

This inspection service is unrelated to the [removed external repository Plugin installation path](../../implemented/simplification/2026-08-09-remove-repository-plugin.md); package acquisition remains profile-bundle-owned. Neither decision supersedes the other.

## Alternatives considered

**Pass Git arguments or roots from the client.** Rejected because repository inspection needs a bounded operation set and existing registered workspace authority, not a general command executor.

**Read host config with includes to discover filters.** Rejected because discovery itself follows external configuration before validating it. Only validated local configuration and conversion-free attribute queries establish supported behavior.

**Treat any filesystem/subprocess pair as one execution world.** Rejected because equal-looking paths do not prove a shared world. Concrete local-provider requirements express the currently supported consumer without an unneeded generic world abstraction.

**Render a shared div-based modal or add a focus-trap framework.** Rejected because native dialog provides inertness and cancellation; a small feature-owned keyboard edge handler supplies strict DOM cycling without changing unrelated dialogs.

## Consequences

Ordinary local repositories have complete bounded comparisons with no Git writes, model prompts or session events. Linked worktrees, includes, filter-driven repositories, submodule and conflict comparisons require separate support decisions. GitHub authentication and repository pairing are independent from sanitized local remote metadata.

Real runnable [application evidence](../../../../examples/repository-inspection/README.md) exercises generated transport, renderer binding, exact patch text, keyboard cycling, inertness, focus restoration and unchanged Git metadata. Package tests cover parser bounds, configuration indirections, cancellation and source/artifact behavior; those tests do not establish worker isolation or authenticated human instruction authority.
