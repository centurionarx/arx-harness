# Platform support

arx Harness runs on Linux, macOS, and Windows. The agent loop, session persistence, plugin resolution, settings, credentials, and every tool except the shell behave the same on all three. This page names what differs and links to the package that owns each contract.

## One shell stack per host

The base bundle mounts exactly one shell family, chosen by platform: `bash-sandbox` and `tool-bash` on POSIX, `pwsh-sandbox` and `tool-pwsh` on Windows, because bash has no Windows runner. The permission surface is identical either way — the same sandbox policy, permission switcher, approval service, and `ctx.fs` fencing apply ([row set and the bash-restore recipe](../../../packages/bundle/base/README.md)).

A model working on Windows therefore writes PowerShell, not bash. Commands, skills, and hooks authored as shell scripts do not carry over.

PowerShell itself is resolved rather than required: an explicit `pwshPath`, then PowerShell 7's install location, then `PATH`, then Windows PowerShell 5.1 as a legacy last resort ([resolution rules and their caveats](../../../packages/shell/pwsh-local/README.md)).

## Confinement differs in kind, not only in mechanism

| Host | Backend | Confines |
|---|---|---|
| Linux | `landlock-run`, or bubblewrap | reads and writes |
| macOS | `sandbox-exec` | reads and writes |
| Windows | ACL restricted token, through the Win32 API | writes only |

The Windows backend needs no external binary: it calls `CreateRestrictedToken` directly. What it gives up is read-side confinement and network policy, which are out of scope for a write-restricted token, and the ability of a confined process to capture a grandchild's piped output — a tool that must capture output cannot run confined ([full boundary and its edges](../../../packages/sandbox/sandbox-windows-acl/README.md)).

The first confined write into a workspace propagates ACLs across the whole tree, once per workspace per machine. On a large workspace that first command is slow.

## Process control is coarser on Windows

POSIX children run in their own process group and are signalled as one. Windows terminates trees through `taskkill /T /F` on a best-effort basis, delivers interrupt as a console-wide CTRL_C event, rejects `SIGTSTP` and `SIGHUP` as unavailable, and reports forced termination as exit 1 with no signal ([termination and signalling contract](../../../packages/subprocess/subprocess-local/README.md)).

Cancelling a long-running command is the daily gesture this affects.

## Durability and plugin resolution are equivalent by different primitives

Session logs publish through `link()` plus a parent-directory fsync on POSIX, and through a write-through rename without replacement on Windows, because Node exposes no parent-directory fsync there ([materialization contract](../../../packages/session/session-persistence-jsonl/README.md)).

The profile module fallback links each package with a junction on Windows, so installing and running need no elevation and no Developer Mode ([profile layout](../../../packages/boot/app-boot/README.md)).

## What Windows does not enforce

The credential document's permission check does not run. On POSIX a `$ARX_HOME/.credentials.yaml` carrying any group or other permission bit fails before it is parsed, and the error names the `chmod 600` repair; Windows has no mode to inspect, so the check is skipped rather than faked ([credential storage contract](../../../packages/credentials/credentials-local/README.md)).

Protect the harness home with the account's own ACL instead.
