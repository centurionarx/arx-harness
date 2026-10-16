# Agent Note: A clone that serves the Web UI builds the official client

Status: implemented

## Problem

A clone that serves the Web UI through a user service rebuilds it on every sync after a merge; the owner's former Azure VM clone `dev-01` did when this decision was made. The sync rule in [a merge reaches the local clone](2026-09-22-a-merge-reaches-the-local-clones.md) stops at the fast-forward and names no build, so each agent wrote the build command from memory. After the 1.0.32 merge the VM ran `pnpm run build && pnpm run build:web`. `pnpm run build` embeds no official client profile, so the sidebar and the new-session headline showed the `ARX Local Build` placeholder instead of the arx HARNESS wordmark; earlier syncs that used `pnpm run build:official` showed it. The owner saw the logo disappear more than once and reported it as a regression.

## Decision

**The sync rule names the build.** [AGENTS.md](../../../../AGENTS.md#after-a-merge-sync-the-local-clone) states that a clone serving the Web UI runs `pnpm install --frozen-lockfile`, then `pnpm run build:official`, then restarts its service, and that `pnpm run build` ships the unbranded client. An agent that cannot reach the clone gives the owner that same sequence.

`pnpm run build:official` already runs the Web build and writes the client build record, so no separate `pnpm run build:web` follows it: a later partial build would rebuild the Vite output without the official values and leave the record describing artifacts that no longer exist.

## Alternatives considered

**Make `pnpm run build` produce the official client.** It would end the failure for every caller, but the unbranded default is deliberate: the official brand ships only under the official client profile ([client build environment](../architecture/2026-08-18-client-build-environment.md)), so a checkout carrying local changes never presents itself as the released product. The README documents `pnpm run build:official` as the branded build from a checkout.

**Commit a sync script or a service unit for a Web-serving clone.** The service name, the remote name and the checkout path are facts of one machine, and the repository would carry them for every clone. The rule needs only the command sequence.

**Leave the build to each agent.** That is how the logo disappeared: the command came from memory and changed between sessions.

## Consequences

- A clone that serves the Web UI keeps the official brand after every agent-given sync, at the cost of one more line in the rule.
- A clone that does not serve the Web UI stops at the fast-forward.
- A deliberate unbranded build stays available through `pnpm run build`, and the Web UI still marks it with `ARX Local Build` and the commit hash.
