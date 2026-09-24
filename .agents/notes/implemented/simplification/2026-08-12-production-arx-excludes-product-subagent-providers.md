# Agent Note: Production arx excludes product subagent providers

Status: implemented

## Problem

`@arx-ai/arx` receives the `@arx-ai/arx-base` dependency closure. Including the Codex and Claude Code subagent providers there makes every production install download optional product integration code and large platform CLI payloads, even when neither integration is used.

## Decision

This decision partially supersedes only the default-inclusion part of the [shared-host placement](../architecture/2026-08-10-product-subagent-providers-in-shared-host.md): `@arx-ai/arx-base` does not depend on or mount the Codex and Claude Code subagent providers. Each provider package is a directly installable Profile Bundle whose `arx.bundle.patch` points to one package-owned `cordis.patch.yml`. Each patch contributes exactly one self-provider Host row and no Agent tool row.

The two Bundles remain independent. The Codex Bundle owns the pinned official wrapper and six platform aliases; production starts the package-declared wrapper and never falls back to a host `codex`. The Claude Code Bundle owns the pinned Agent SDK and matching platform CLI; production lets the SDK select that private CLI and never falls back to a host `claude`. Installing one Bundle does not pull in the other, and the default `@arx-ai/arx` production closure contains neither provider package. That closure does contain both product runtimes with their platform payloads: the base bundle's [`arx-llm-agent-cli`](../../../../packages/llm/llm-agent-cli/README.md) package pins the Claude Agent SDK for its dormant route under the [vendor-CLI route decision](../feature/2026-08-26-vendor-cli-as-model-route.md), and its [`arx-native-accounts`](../../../../packages/credentials/native-accounts/README.md) package pins the same SDK and the Codex wrapper under the [native account decision](../feature/2026-09-24-native-account-and-chat-sign-in.md). Each installed Bundle registers a dormant provider on the next Profile start, while an Agent Preset independently decides whether a new Session receives the corresponding tool. Installation does not start a product, authenticate an account, rewrite native settings, or grant model access.

## Verification

Package tests pin both Bundle manifests, published patches, exact self-provider rows, and product runtime dependencies. Claude coverage pins Agent SDK 0.3.281, Claude Code 2.1.281, all eight platform packages, SDK-selected execution, and missing-payload failure without host fallback. Codex coverage pins wrapper 0.147.0, all six platform aliases, package-declared execution, native descendant quiescence, and the same missing-payload behavior. Workspace validation derives each published patch from its Bundle declaration rather than a package catalog. Package assertions prove that neither provider Bundle depends on the other and that `arx-base` neither depends on nor mounts either provider; no test walks the transitive `@arx-ai/arx` production closure. Real Bundle-patch and Agent-Preset composition covers none, either product, both, the tool-grant intersection, later-Session adoption, and zero startup processes.

## Alternatives considered

**Keep dormant providers in the base bundle.** Dormant providers start no product processes, but their packages still enter every production npm install.

**Add a wrapper or meta Bundle.** A third package would duplicate installation ownership and make independent removal less direct without contributing another runtime capability.

## Consequences

Installing `@arx-ai/arx` does not download either product provider through the base bundle, but it downloads both product runtimes through the services named above; the exclusion keeps out the provider packages and the Codex Bundle's separately pinned release. A Profile can add or remove either provider Bundle independently; changed Host availability takes effect on the next Profile start, and selecting a product installs that Bundle's own pinned runtime into the Profile. A separately authored Agent Preset grants either model-visible tool only to newly composed Sessions. No wrapper package beyond the products' official distributions, meta Bundle, dynamic installer, or persisted product-enable state is introduced.
