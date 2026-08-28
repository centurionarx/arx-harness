# Agent Note: Name the composed route for its role, not for a vendor

Status: implemented

English | [中文](2026-08-28-name-the-route-for-its-role.zh.md)

## Problem

The harness ships no provider, yet every composition still spoke one vendor's vocabulary: the route key `deepseek-official`, the model ids `deepseek-v4-pro` and `deepseek-v4-flash`, the credential reference `DEEPSEEK_API_KEY`, a hardcoded endpoint, and a brand ramp named for that vendor in the design tokens.

[Making that vendor configuration rather than code](2026-08-28-deepseek-is-configuration-not-code.md) kept those names deliberately: a route key names a third-party fact, and renaming it would describe an endpoint that does not exist. That reasoning holds for a route a deployment dials. It does not hold for these, because after that change no shipped composition declares an endpoint at all — the key named a provider nothing was configured to reach.

Deleting the adapter also left five configurations and four package READMEs naming the deleted package, or relying on an `initialize` fallback the SDK server no longer has. Each failed at load or at handshake, and CI on the base branch was red on four jobs before this work began.

## Decision

The composed route is `primary`, its models are `primary-pro` and `primary-flash`, and its credential reference is `PRIMARY_API_KEY`. These are placeholders a deployment overwrites, and they say so: nothing claims a real endpoint answers to them. The endpoint stays a shipped literal in the reserved `.test` TLD, which never resolves, because [configuration source ownership](2026-08-04-configuration-source-ownership.md) puts composition above the launching shell precisely so a stray `PRIMARY_BASE_URL` cannot decide where a resolved credential and the prompts carrying a user's code are sent. A deployment replaces the literal, or overrides it in the tier above — a patch overlay, which is how the keyless smoke points the shipped tree at its mock server.

`arx-llm-pi-ai` keeps its own `deepseek` catalog key untouched. That key is the upstream library's vocabulary, not this repository's; renaming it would break the type that gates catalog drift.

The design tokens' primary ramp is `--arx-static-brand-*`, repainted in arx's own blue. Each step keeps the WCAG relative luminance of the step it replaced, so contrast ratios against surface and text tokens are unchanged.

## What a hand-declared route must spell out

pi-ai's installed catalog describes no `primary` route, so a profile naming it inherits nothing and must supply the whole provider:

- `models` — a route with no list resolves no models and the loader refuses the tree.
- `reasoningEfforts` per model — without them a route-level `reasoning` level is unservable and the request fails `UNSUPPORTED_REASONING_EFFORT`.
- `compat.maxTokensField` — `openai-completions` sends `max_completion_tokens` by default, which a plain chat-completions host ignores.
- `baseURL` — the installed catalog supplies none, so a route without one is refused at load.

## Alternatives considered

**Keeping the vendor route key, as the prior note decided.** Its argument was that `deepseek-v4-pro` is the id the endpoint answers to. Superseded rather than contradicted: that is true of a configured route, and this repository no longer configures one. A placeholder that names a real vendor's models is the lie, not the other way round.

**Mounting an adapter fallback in the SDK server again.** It would have kept the bundled Python runtime and the boot tests working with no config change. Rejected: the prior note removed that fallback precisely because it answered with a provider the caller never configured, and reinstating it to avoid writing five profiles trades a real contract for five lines of YAML.

**Mounting `arx-llm-pi-ai` dormant in the bundled Python runtime.** It names no vendor and holds no secret, which is tidy. Rejected: with no profile there is no route, so every zero-config launch would refuse the Python SDK's own default `provider`/`model`. The runtime now declares that route with its endpoint and credential from the environment, which holds no secret either.

**Reading the example endpoints from `PRIMARY_BASE_URL` instead of shipping a literal.** It would let the keyless smoke point the shipped tree at its mock server with one variable, and the example READMEs already listed that name. Rejected, and `verify-config-source-ownership` rejects it too: an endpoint decides where a resolved credential goes, so letting the shell name it inverts the ordering that makes the deployment tier meaningful. The overlay tier does the same job without that inversion.

## Consequences

Every replay fixture header carries the recorded provider and model, so renaming the route rewrote them — 597 files in one change. The fixtures replay against their own recordings, so no re-recording and no key was needed.

`LICENSE`, `THIRD_PARTY_NOTICES.md`, `vendor/README.md`, and the archived Agent Notes keep the upstream attribution they carry. MIT permits sublicensing on the condition that the notice travels with the work, and `vendor/README.md` pins the upstream SHAs its sync procedure resolves; neither is branding.

`Issue policy` and `Issue lifecycle` check out the repository's **default branch** on purpose, so they run that branch's `.github/issue-management/config.json` no matter what a pull request contains. The organization name corrected on a feature branch therefore cannot turn those checks green; they stay red until the correction reaches the default branch. This is a property of the trusted-checkout pattern, not a defect in either branch.

The real-API `e2e` job needs a repository secret `PRIMARY_API_KEY_EXTERNAL` and a repository variable `PRIMARY_BASE_URL`. Its preflight refuses a missing one rather than letting the self-skipping suite report a false green.

## Related

[Making the vendor configuration rather than code](2026-08-28-deepseek-is-configuration-not-code.md) deleted the adapter whose name this note removes, and named the `ui-settings-models` dead paths as remaining work; this note removes them. [No shipped default model](2026-08-27-no-shipped-default-model.md) removed the composition default that made a vendor-named route reachable at all.
