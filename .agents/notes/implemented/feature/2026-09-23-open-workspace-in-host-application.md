# Agent Note: open the session workspace in a host application

Status: implemented

## Problem

The Web session header had no way to hand the workspace directory to the tools a person works in beside arx: an editor, a Git GUI, a terminal, or the file manager. The only native hand-off was `host.openPath`, which opens one path with the operating system's default application and cannot choose which application. The upstream snapshot source added an "Open In" split button after this repository was copied from it (upstream commits `9292dd8a2d`, `7f47954cad`, and later refinements through `9a485724f6`). The owner asked for that button with File Explorer, VS Code, and GitHub Desktop, plus Windows PowerShell, PowerShell 7, and Git Bash — including Git Bash from the per-user installer, which lives under `%LOCALAPPDATA%` rather than `%ProgramFiles%`.

## Decision

Two packages carry the feature, mounted by the `arx-web-app` bundle rows `open-in-app` and `ui-open-in-app`:

- **[`arx-host-open-in-app`](../../../../packages/host/open-in-app/README.md)** resolves a compile-time catalog of editors, Git GUIs, terminals and shells, and file managers to launchers this host holds — a verified bundle, executable, or PATH resolution, never a bare install record — once per process and lazily. A launch that finds its executable gone re-resolves that entry once and drops it when nothing proves it anymore. The catalog, resolver, icon extraction, and desktop-entry helpers are ported from the upstream package with the scope renamed and every Chinese string translated.
- **[`arx-client-ui-open-in-app`](../../../../packages/client/ui-open-in-app/README.md)** registers the split button into `conversation.session.header.utilities`: the main half opens the default application, the chevron lists every application with the default marked, and a successful pick from the list becomes the default, persisted in the browser.

The host serves one **connection RPC channel, `/open-in-app`, registered with `authority: 'loopback'`**, with three endpoints: `apps` (the resolved ids), `icon` (one application's icon as a data URL), and `open` (launch on a directory). The upstream package registers three raw HTTP routes guarded by its connection service's `requestRejection`, which pairs a Host/Origin fence with browser authentication. This repository has neither that method nor browser authentication. What it does have is the loopback fence that already pins `host.openPath` and the other desktop-acting gateway methods, available to any plugin through `ctx.connection.rpc.handle`. Launching on the host desktop and listing its applications belong behind that fence, so the channel admits only a same-origin request to this machine's loopback address. Icons ride the same channel as data URLs, so the feature has one transport and one fence; the Web GUI sets no Content-Security-Policy that would refuse `data:` images. Payload validation stays in the plugin, answering from the closed RPC error vocabulary: `bad-request`, `open-unavailable`, `workspace-invalid-path`, `directory-unreadable`, and `internal`. The client does not call the channel at all from a page that is not on loopback.

The Windows console shells open **in** the workspace directory without the path reaching a command line. Windows PowerShell (`${SystemRoot}\System32\WindowsPowerShell\v1.0\powershell.exe`) and PowerShell 7 (`pwsh` on PATH) start with `-NoExit` and the directory as their working directory, so the `-Command Set-Location '<path>'` form and its quoting rules for apostrophes do not exist. A catalog locator marks this with `startsInPath`. Git Bash keeps its `--cd=<path>` argument. It resolves from its Uninstall record, then the machine install under `${ProgramFiles}`, then the per-user install under `${LOCALAPPDATA}\Programs\Git`. Every console launch is detached and visible.

Two shared helpers move to their upstream homes because the feature gives each a second consumer. The path opener behind `host.openPath` moves from `arx-host-apiproxy` into `arx-native-command` (`canOpenNativePath`, `openNativePath`, `openNativeTextFile`), which the file-manager entries use for the operating system's open verb. `launchedThroughSsh` joins `arx-launch-environment` and replaces the Web launcher's private copy: an SSH launch offers no host applications, and only the inherited process layer can establish one. The XDG desktop-entry helpers stay inside the host package, their only consumer here.

## Alternatives considered

- **Raw webServer routes, as upstream.** Rejected: guarding them would mean either exporting the connection package's request-trust function as new public API, or re-implementing the loopback check in this package — a second home for a security rule. The RPC channel reuses the existing fence as is. The cost is icons as base64 data URLs rather than cacheable GETs, which is small for 32–128px artwork read once per page.
- **Riding the shared `/api` gateway as Typert Remote methods.** Rejected: the gateway interceptor runs at `trusted-host` authority, so a LAN deployment's trusted host could list and launch host applications; this channel needs loopback.
- **`-Command Set-Location -LiteralPath '<path>'` for PowerShell.** Rejected in favour of the working directory: the quoted form must double every apostrophe and still passes the path through PowerShell's parser, and the working directory needs no escaping at all.
- **Porting the upstream document-preview, deliverable, and file-review controls.** Deferred: they depend on upstream surfaces and a workspace-path Remote this repository does not have; the header button is what was asked for.
- **A configurable catalog.** Deferred as upstream did: each entry couples discovery, launch arguments, process policy, and icon behavior, and a user-defined command needs a settings owner and validation rules first.

## Consequences

- The Web header shows the button on a loopback page whose host resolved at least one catalog application, and nothing otherwise — including every SSH launch and every LAN-host page.
- Web e2e scenarios keep both rows disabled unless a scenario asks for them (`launchWebScaffold({ openInApp: true })`), because application discovery depends on the running machine. The `open-in-app` web lane owns that machine's inputs: PATH holds only stand-in launchers, a display is announced, and the XDG roots are empty. It records the button, the menu, and the launches on the workspace directory.
- `arx-native-command` now exports the path openers, and `arx-host-apiproxy` imports them from it; `host.openPath` behavior is unchanged.
- The client bundle preset inlines `@arx-ai/arx-host-open-in-app/shared`, the channel's names and payload types, and the purity spec pins that exact subpath.
