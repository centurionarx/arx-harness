# Agent Note: the checkout owns the `arx` command

Status: implemented

## Problem

A developer inside a checkout ran `npx @arx-ai/arx web` and got a Web UI from a different release, with no error and no sign that anything was wrong. The version under the wordmark named a build that no longer existed in the repository, and hours went into looking for a bad push.

The workspace root declared no dependency on `@arx-ai/arx`, so pnpm linked no `node_modules/.bin/arx`. `apps/cli/package.json` still names the package and its `arx` bin, so `npm exec @arx-ai/arx` inside the checkout resolves the command name from the workspace and then runs it through the shell — and the shell takes `arx` from `PATH`. Any previously installed release shadows the checkout.

Outside a checkout the same command fails loudly with a registry 404, because the package is not published. The trap exists only where the workspace supplies the name, which is exactly where a developer expects the checkout to win.

## Decision

The workspace root depends on `@arx-ai/arx`, so pnpm links `node_modules/.bin/arx` into the checkout. Inside a checkout `arx` and `npm exec @arx-ai/arx` both reach `apps/cli`, and no installed release can shadow it.

The dependency is imported by nothing — it exists to own the command name — so `knip.json` lists it under `ignoreDependencies`. The root already carried `@arx-ai/arx-tool-session-query` on the same footing.

`pnpm arx` is unchanged and still runs the source through tsx. The linked bin runs `apps/cli/lib/bin.js`, so it answers only after a build; a missing build fails in the checkout instead of silently succeeding somewhere else.

The README names both traps at the command that springs them: `npx @arx-ai/arx web` needs a published release and yields the `PATH` command inside a checkout, and `pnpm run build` produces an unbranded client whose Web UI shows the `ARX Local Build` placeholder.

## Alternatives considered

**Documentation alone.** The README already pointed at `pnpm arx web`, and a reader who follows it is never bitten. Rejected as sufficient: the failure is silent for anyone who does not follow it, and a silent wrong version costs more than a linked binary does.

**Publishing the package.** A published release makes `npx @arx-ai/arx` mean one thing everywhere. Rejected as the fix for this: publication is a release decision with its own cadence, and it would not stop an installed release from shadowing a checkout.

**Pointing the bin at the tsx source launcher.** It would work without a build. Rejected: the bin is the published artifact's entry point, and giving the checkout a different one would make the linked command diverge from what users get.

## Consequences

`arx` inside a checkout requires a build. That is the intended trade: the command now fails where the developer is, rather than resolving to an unrelated install.

The knip exception is load-bearing. Removing it makes the gate report the dependency as unused and the entry looks like dead weight; the reason it exists is the bin link, not an import.
