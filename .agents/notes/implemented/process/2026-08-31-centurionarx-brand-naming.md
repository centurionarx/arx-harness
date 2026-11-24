# Agent Note: Centurionarx brand naming and the DeepSeek access config

Status: implemented

English | [Português](2026-08-31-centurionarx-brand-naming.pt-BR.md)

## Problem

The product was rebranded to arx, but the model vendor's name still appeared across roughly 750 files carrying three different senses: the organization presented as behind the product, the LLM provider the harness ships against, and the credentials that reach that provider. Nothing distinguished these senses, so product surfaces — the website, UI strings, agent personas, documentation — still presented the harness under the earlier brand, while a blanket find-and-replace would have broken the very configuration that reaches the model.

## Decision

The vendor name `DeepSeek` appears only in model-access configuration and license notices, in exactly three classes of places:

- The credential variables `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL`, the provider account login, and the documentation that specifies them.
- Provider identity in configuration and code: the provider id, model names (`deepseek-*`), the API host, and the `packages/llm` provider implementations and their READMEs.
- License and copyright notices: `LICENSE` files, `THIRD_PARTY_NOTICES.md`, vendored sources, and attribution lines that carry the vendor's copyright notice.

The owner treats arx Harness as a new product owned by Centurionarx, so no other passage names the vendor as the project's author, origin, owner, or design reference: the original repository and its snapshots are "upstream", the vendor's consumer chat product is "the reference chat client", and its websites, package scopes, and design-system names that contain the vendor name do not appear. Every other mention is brand usage and is written as follows: the organization is Centurionarx, the product is arx, the harness is arx Harness. Commit messages follow the same rule; the published history was rewritten message-only as part of this change, and blobs were left untouched so historical content stays byte-identical.

## Alternatives considered

- **Rename the access identifiers too** (env vars, provider id, model names). Rejected: they name DeepSeek's actual API; renaming them severs the link between the documentation and the service the credentials reach, and breaks every existing `.env`.
- **Change branding only forward, keep the published history.** Rejected by maintainer decision: the commit log is a product surface, and brand mentions in it read as identity. The accepted cost is that existing clones and the old `dsh-*` tags map to rewritten commits and collaborators must re-sync after the forced push.
- **A blanket text replacement across the tree.** Rejected: with no sense classification it would have rewritten the access configuration itself; classification-first replacement was chosen instead.

## Consequences

- A case-insensitive `deepseek` search over the tree returns only access-config surfaces and license notices: credential variables and their docs, provider configuration and implementations, and copyright and third-party notices.
- History rewriting invalidates existing clones; PRs referencing old SHAs and the unmapped tags are the known breakage the maintainer accepted.
- [`verify-vendor-name`](../../../../scripts/verify-vendor-name.ts), a `doc-sync` gate, removes sentences that hold a vendor copyright notice, then fails a line that holds a brand form (including an authorship or origin claim such as "built by" the vendor or the vendor's "product"), or a vendor-name occurrence that is not a model-access form and has no model-access term within eight words; its brand forms, access forms, and access terms are one closed list. A line that mixes brand prose with a nearby access term passes unless it holds a listed brand form, so review still owns new phrasings. Recorded snapshots are scanned too: a re-recorded model reply that names the vendor in plain prose fails until its wording or the closed list changes. No path is exempt ([retirement of the upstream-sync tooling](2026-11-24-retire-the-upstream-sync-tooling.md)): license files and vendored sources are scanned, and their copyright sentences pass as license notices.
- Root `AGENTS.md` carries the one-line rule; this note owns the rationale and the keep-classes list.
