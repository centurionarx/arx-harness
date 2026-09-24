# Agent Note: Portuguese site navigation and a current proposal inventory

Status: implemented

## Problem

The documentation site's root locale declared Brazilian Portuguese while its navigation, search, and accessibility labels remained Chinese. Its end-user guides had no Portuguese counterparts. The root README also described the project as closed-source while linking to MIT, and the release roadmap mixed historical failures with features already implemented elsewhere in the repository.

## Decision

The [publication manifest](../../../../website/docs.ts) and [VitePress configuration](../../../../website/.vitepress/config.ts) publish Portuguese navigation, search, and accessibility text at the root locale, retaining the English route tree. The active bilingual corpus includes the locale home and the Web quickstart, providers, platforms, Python SDK, and access/security guides. Their sibling Portuguese files preserve code examples and link into the corresponding active pairs; developer tutorials and generated references continue to project English until a complete reviewed pair enters the corpus.

The README uses a neutral description of the plugin-based harness. The MIT link, LICENSE contents, ownership, and logo assets are unchanged. The quickstart describes provider selection rather than assuming a preconfigured vendor.

The [access and security guide](../../../../docs/user/guide/security.md) distinguishes local loopback use, authenticated SSH forwarding, and externally operated network access controls. It does not claim to add authentication, TLS, origin enforcement, network isolation, or multi-tenant isolation to the runtime.

The [release and integration proposal](../../proposed/process/2026-09-05-ship-sync-integrate-then-translate.md#current-disposition) retains its historical evidence and sequencing rationale but places current dispositions before the original phase specifications. Browser-locale conversion, SDK and PowerShell repairs, active-corpus pairing, durable webhooks, and ACP settlement waiting are not presented as missing implementations. Release checks are properties of an exact revision, not conclusions inferred from old notes. The two SDK architecture proposals remain optional; the broader translation, sync-policy, and connector work remains proposed.

## Alternatives considered

- Translating the entire corpus would couple a bounded site correction to generated references and hundreds of independent decisions. The active-corpus mechanism permits complete user-facing pairs without weakening existing pair validation.
- Relabeling the root locale as Chinese would preserve the mismatch with the repository's Portuguese documentation policy.
- Deleting the release proposal would discard still-useful import constraints and alternatives. It is partially superseded, so it remains active with a current disposition and links to the implemented owners.
- Claiming the server is safe for direct network exposure would confuse documentation with a runtime security implementation. The guide requires independently configured and tested access controls.

## Consequences

Portuguese readers receive localized site navigation and the initial usage guides; untranslated references remain explicitly English. Every touched pair is recorded through the official translation-pairing tool. The site regression tests reject Chinese chrome and navigation, assert the Portuguese locale and guide projections, and retain source-link and raw-Markdown checks. Global release checks and deployment verification remain separate from these focused tests.

No implemented Agent Note is fully superseded by this correction. The roadmap's remaining proposals retain their rationale and triggers rather than being archived or marked complete.
