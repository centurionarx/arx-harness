# Agent Note: GitHub private authorization and read-only discovery

Status: implemented

## Problem

GitHub repository selection needs authenticated account metadata without turning the client into a credential resolver or a general network requester. A successful reference write can leave a different credential effective, and cancellation must not publish authorization before the actual record commits. Masked prompts and file permissions do not exclude an unrestricted same-UID coding agent from local credential storage.

## Decision

The [GitHub service](../../../../packages/git/github/README.md) reuses the existing credential record and authorization services. Default configuration is explicitly unconfigured and exposes no secret-collection flow. Operator-selected record mode owns only github/account; reference mode resolves an explicit reference and offers no record-writing flow. Record writability is provider authority, not environment precedence or an authenticated-human access control.

Human PAT submission uses the private generic authorization interaction and serialized record mutation. The GitHub plugin checks cancellation before enqueue and within the mutation callback, and never rolls back a completed commit. It withdraws its registration, aborts operations and joins outstanding stream cancellation before disposal completes. Strong secret/control isolation is a deployment prerequisite, not a promise of this plugin or its masked input.

Generated Remote methods expose only account metadata and locally bounded repository pages. Native fetch uses fixed GitHub GET endpoints with redirect refusal; it never follows pagination URLs or accepts caller URLs, credential selectors or token-taking RPCs. Complete projected responses have independent byte bounds and credential-reflection checks; fixed failures exclude upstream diagnostics and secrets.

The [client plugin](../../../../packages/client/ui-github/README.md) contributes GitHub to settings.section independently from repository.github. Settings owns the private attempt and its native dialog; account configuration needs no workspace. Leaving the section cancels its mounting lease, and late cleanup cannot cancel a subsequent mounting lease. One plugin-owned controller publishes shared account facts and repository pages, with private authorization facts delivered only to the settings entry. Each contribution waits on the actual slot declaration; removal and redeclaration reuse the plugin-owned controller while caller disposal releases listeners and pending operations. Repository navigation offers the existing settings/open-section route and retains the Git inspection owner's workspace selection.

## Alternatives considered

**Add a PAT-taking GitHub Remote or a second authorization broker.** Rejected because existing private prompts, attempt ownership and observed credential commits provide the required interaction without another secret-bearing public operation or state owner.

**Discover ambient GITHUB_TOKEN or emulate reference shadowing in record space.** Rejected because explicit record and reference modes name different existing provider operations. A fallback could authenticate with a credential other than the one the human changed.

**Implement OAuth without an operator application id.** Rejected because device authorization needs an explicitly registered client identity. PAT authorization uses existing capabilities without silently selecting an external application.

**Treat localhost and same-UID file permissions as secret isolation.** Rejected because unrestricted agent tools can read stores and invoke local APIs. Deployment isolation remains an independent human decision.

## Consequences

GitHub metadata remains user-facing data, with no automatic model input or session event. First account reads validate a stored PAT; a 401 reports disconnected and preserves credentials for human replacement. Authentication does not clone repositories or grant stage, commit or push operations. Explicit workspace pairing uses the repository inspection owner rather than a separate selection that could inspect a different project.

The TypeScript resolution facade retains generated Remote declarations and their namespace augmentation. The client bundler resolves generated /remote values through the owning package runtime exports. It resolves package.json first and reads the declared default export because the tsx loader applies declaration-only Remote aliases to require.resolve as well. The real tsx bundling regression runs in the existing build-dependent Remote artifact smoke because runtime exports require generated JavaScript. Documentation typechecking retains aliases that already point at generated declarations, while source gates need no generated runtime artifacts. The repository shortcut uses Configure GitHub so partial Settings-button queries continue to identify only the settings trigger.

[Loader tests](../../../../packages/git/github/README.md#verification) exercise actual authorization and credential commits with external fetch responses faked. Generated artifacts require the runtime Zod dependency they import. Neither those tests nor a private prompt establish an isolated secret process or authenticated operator authority.
