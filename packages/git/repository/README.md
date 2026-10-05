# @arx-ai/arx-repository

Read-only repository BFF registered as `ctx.repository`, extending `TypertRemoteService`. Its Remote methods do not need an active Agent or session and emit no tool or session events.

## API

- `inspect({workspaceId}, signal)` returns the canonical repository root, branch (null when detached), head (null when unborn), local ahead/behind counts (null without upstream counts), and remote names with allowlisted transport and host only. URLs, user information, queries, and repository paths are not exposed.
- `status({workspaceId}, signal)` returns independent `staged`, `unstaged`, `untracked`, and `unmerged` arrays. Entries carry repository-relative paths, porcelain XY and submodule fields, and an original path for renames. A path can appear on both tracked sides.
- `diff({workspaceId,path,side}, signal)` accepts only a current status path on `staged`, `unstaged`, or `untracked`. It returns complete unified text or `binary: true` with empty text. Conflicts and submodules have no diff preview.

Workspace ids are looked up in `ctx.workspaceRegistry`; callers cannot supply roots or working directories. The registered workspace itself must contain an ordinary `.git` directory. Git-reported roots use native path normalization before comparison with the canonical workspace root. Parent repository discovery, linked gitdir files, common directories and configured worktrees are unsupported. Before any Git invocation, a bounded scan checks every metadata parent and leaf through the actual filesystem provider, rejects symlinks and special files, and validates HEAD/loose reference targets. Object alternates, HTTP alternates, promisor markers and worktree configuration files are refused. Diff paths cannot traverse outside the repository, include Git metadata, or traverse symlinks. Git runs through managed subprocess argv, without shell interpretation, optional locks, prompts, pagers, hooks, fsmonitor, external diff, textconv, or network operations. Credential-shaped ambient environment variables are scrubbed by the subprocess provider; ambient Git and SSH controls are removed. Git diagnostics are never exposed. The first Git invocation reads only the validated local config with `--file` and `--no-includes`; bounded parsing refuses all includes/conditional includes before any ordinary repository command. Nonempty local clean/process filter definitions are refused with `REPOSITORY_UNSUPPORTED_FILTERS`, without running them or exposing their values. Every Git invocation disables system/global configuration using Git's portable `/dev/null` spelling, pins validated Git/worktree paths, clears external attribute/exclude sources, and suppresses submodule execution. Safe `ls-files` and `check-attr` queries then inspect working-tree and indexed filter attributes without conversion. Any selected filter driver is refused, including drivers absent because host configuration is excluded; no exact Git LFS comparison is claimed. Attribute lookup refuses symlinked parent directories before reading their attribute files.

## Configuration and failures

`maxBytes` defaults to 2097152 (ceiling 16777216), `maxItems` to 10000 (ceiling 100000), `timeoutMs` to 10000 (ceiling 120000), and `graceMs` to 250 (ceiling 10000). `maxMetadataItems` defaults to 100000 (ceiling 1000000), and `maxMetadataBytes` defaults to 16777216 (ceiling 67108864). The metadata scan streams names using host `opendir` because provider `listDir` buffers all children and resolves links; provider lstat/resolve/readBytes enforce each candidate before Git. Metadata bytes count cumulative full path names and HEAD/loose reference content. All limits are positive safe integers. `maxItems` also bounds local-config records and tracked/untracked attribute inventory paths. The byte limit covers combined complete stdout/stderr per command and the complete UTF-8 JSON response; overflow rejects rather than parsing a truncated tail. The deadline covers the whole request. Disposal aborts requests and awaits managed process quiescence.

Failures are sanitized `REPOSITORY_*` error messages, distinguishing invalid requests/config/paths, unknown or unavailable workspaces, missing Git/repository, outside-workspace repositories, unsupported providers/worktrees/paths/encoding/conflicts/submodules, changed status, command/result and metadata byte/item limits, timeout, cancellation, process failure and disposal. No raw URL, stderr, spawn exception or filesystem exception escapes. Malformed config, root, remote, inventory, attribute and status output, invalid UTF-8 metadata or process output, and missing requested process pipes are refused.

## Model Experience

### Repository Remote calls

#### What the model sees

Nothing from `repository.inspect`, `repository.status` or `repository.diff`: this package contributes no tools, prompts, or session events.

#### Token effect

Zero direct token effect.

#### KV Cache effect

No model-request prefix or cache changes.

## Known Limitations and Deferred Work

- Only trusted host-backed `LocalSubprocessRuntime` and `LocalFileSystem` implementations are supported; `SandboxedFileSystem` inherits the latter and is accepted. The actual current services are checked at load and at every operation. E2B and remote providers fail explicitly; equal path strings are not execution-world identity. Local clean/process filters, config includes/conditional includes (including internal includes), and worktree configuration are unsupported. System/global configuration is never read. Attribute-selected filter drivers are unsupported whether defined locally, omitted by host isolation, or present only in indexed attributes. This package does not claim globally configured Git LFS or other host transformation semantics. Partial/promisor clones (which can lazily fetch), external worktree metadata, bare repositories, submodule working-tree inspection, conflict diff previews, non-UTF-8 Git output, and symlink diff paths are unsupported. Filesystem checks narrow but do not eliminate concurrent path-replacement races; repository observations are not transactional snapshots. No fetch, clone, authentication, writes, watchers, or GitHub integration is included.
