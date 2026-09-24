# Agent Note: Web search credential onboarding

Status: implemented

## Problem

The Web search page needs a credential reference from each provider’s effective settings before it can offer a key form. The shipped bundle mounted Exa and Perplexity without that reference. Their runtime defaults could resolve environment keys, but a keyless installation had no UI path to become usable. A test overlay supplied the missing references only to the onboarding scenario, leaving the shipped snapshot to preserve the defect.

## Decision

The [Web bundle](../../../../packages/bundle/web-app/cordis.patch.yml) declares `apiKeyEnv: EXA_API_KEY` for Exa and `apiKeyEnv: PERPLEXITY_API_KEY` for Perplexity. These names match the providers’ existing fallback references; the configuration contains neither secret values nor a selected provider. The [settings page](../../../../packages/client/ui-settings-web/README.md) continues deriving its fields from effective settings instead of guessing provider-specific names.

Writes use the existing credentials provider. Its managed document stores keys separately from settings, and its inherited-environment precedence remains read-only. Saving a key changes local availability without contacting the search service. No usable key leaves searches unavailable; one usable provider resolves automatically; two remain ambiguous until the user pins one. Removing the other provider’s key does not change that pin.

## Alternatives considered

**Infer reference names in the browser.** This would duplicate provider defaults and could write to a reference an overlay does not use. Explicit composition keeps the effective settings authoritative, including deployments that deliberately omit references.

**Supply references only in the test overlay.** That proves the configurable deployment works but cannot detect a broken shipped onboarding path. The main scenario boots the real bundle without an extra overlay. A separate overlay removes references only to verify the no-guessing behavior.

**Pin a shipped provider or require credentials at boot.** Either changes the existing deployment choice: a pin resolves ambiguity on the user’s behalf, while required credentials prevent keyless setup. Neither is needed to expose the key forms.

## Consequences

The change retains the provider-selection and credential-ownership decisions in [both search providers, with a chosen one](../architecture/2026-09-03-both-search-providers-with-a-chosen-one.md). It closes the shipped gap recorded by [the browser-lane note](../testing/2026-09-07-the-browser-lane-asserts-the-copy-that-ships.md); both notes remain active for their independent architecture and testing rationale. A whole-config overlay must carry its intended `apiKeyEnv` if it wants a key form.

## Verification

The [browser scenario](../../../../apps/web/tests/web-search-settings.e2e.ts) uses the real Loader, providers, credential store, and settings RPCs with isolated storage and scrubbed search-key and selection environment variables. Keyless ARIA snapshots cover empty writable fields, one usable provider, ambiguity, and an explicit selection. The scenario also verifies credential-file writes, absence of secrets in settings and snapshots, cleared password drafts, reload persistence, key removal, and a reference-free deployment. Fake keys require no paid API call; remote authentication and retrieval remain outside this onboarding test.
