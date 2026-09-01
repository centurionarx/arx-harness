# Agent Note: stopping the harness from its own UI

Status: implemented

## Problem

A user who started the Web server had no way to stop it from the surface they were using. The launcher already owned a bounded process exit and provided it as `ctx.appExit`, but nothing reached it from a client, so ending the harness meant finding the process in a terminal.

"Exit" also had no agreed referent. The harness carries an anonymous identity and holds no login of its own, so the row could plausibly have meant stopping the process, clearing the provider credential its host CLI holds, or merely returning to the start view. Those are three different products.

## Decision

Exit stops the harness and nothing else. It clears no credential: the provider token the harness reads from its host — the Claude Code OAuth file, for the subscription route — belongs to that CLI's install, and a button in this UI revoking it would reach outside the harness's own lifetime.

`host.exit` carries the request. It answers before the process goes, because the connection carrying the answer dies with the server: a client hears `stopping`, never `stopped`. A deployment whose launcher provided no exit request refuses with `exit-unavailable` rather than resolving on a shutdown that will not happen.

The method is pinned to loopback beside the native dialogs and the configuration plane. `trustedHosts` is a DNS-rebinding fence, explicitly not authentication, so on a LAN deployment an unpinned exit method would hand any reachable caller a shutdown switch.

[`arx-client-ui-exit`](../../../../packages/client/ui-exit/README.md) occupies `sidebar.exit`, a seat ui-sidebar declares below Settings. The existing `sidebar.footer.action` list renders *above* Settings, so a footer action could not answer the request; the shell declares the new seat rather than moving the old list, which would relocate every action already registered there.

The row confirms first. This is not ceremony: the control ends the server serving the page, so the viewer cannot undo it from the UI they are looking at. The confirmation's primary action names the consequence ("Stop the server") rather than repeating "Exit", which would put two identically-named buttons in the accessibility tree at once.

## Alternatives considered

**Reusing `sidebar.footer.action`.** It is a list at the sidebar foot and already carries occupants, so an exit row would have cost nothing to register. Rejected: it renders *above* Settings. Moving the list below would relocate every action already in it — a visible change to unrelated features, to place one new row.

**No confirmation.** Sessions are durable and a restart resumes them, so the action is recoverable in the sense that matters. Rejected anyway: recovery requires a terminal the viewer may not have open, and the UI offering the button is the first thing the click destroys.

**Exit as logout.** Clearing the host CLI's provider credential would make the word mean what it means in most products. Rejected: that credential belongs to another program's install and is shared with every other use of it on the machine, so this button would reach outside the harness to revoke something it never issued.

**A `stopped` answer.** Waiting for the process to be gone before answering reads as more honest. Rejected: it cannot be delivered — the connection carrying it dies with the server — so the wait would always end in a transport error that means success.

## Consequences

A started shutdown never returns to idle. The row reports `Stopping…` and disables itself, because the page it lives on is going; there is no success state to render, and no restart path from the browser.

`sidebar.exit` is `kind: 'single'`: one exit control is the whole point, and a list would let two deployments each contribute one. Sessions survive — logs are durable, so a restart resumes them, which is what makes an unconfirmable action acceptable at all.

## Related

[Config-plane boundaries](../architecture/2026-07-30-config-plane-boundaries.md) owns which methods stay loopback-only and why `trustedHosts` is not authentication; this note adds the shutdown request to that set for the same reason. [CLI signal shutdown escalation](../bug-fix/2026-08-03-cli-signal-shutdown-escalation.md) owns what the launcher does once asked.
