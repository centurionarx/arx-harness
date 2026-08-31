# Agent Note: Centurionarx brand naming and the DeepSeek access config

Status: implemented

English | [中文](2026-08-31-centurionarx-brand-naming.zh.md)

## Problem

The product was rebranded to arx, but the previous owner's name still appeared across roughly 750 files carrying three different senses: the organization behind the product, the LLM provider the harness ships against, and the credentials that reach that provider. Nothing distinguished these senses, so product surfaces — the website, UI strings, agent personas, documentation — still presented the harness as DeepSeek's, while a blanket find-and-replace would have broken the very configuration that reaches the model.

## Decision

`DeepSeek` appears in exactly three classes of places, all of which name the model access configuration:

- The credential variables `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL` and the documentation that specifies them.
- Provider identity in configuration and code: the provider id, model names (`deepseek-*`), the API host, and the `packages/llm` provider implementations and their READMEs.
- Third-party attributions: `THIRD_PARTY_NOTICES.md`, lockfiles, historical links to the pre-rename repository and its issues, the rebrand tooling that names the old identifiers it maps, and citations of external products' design decisions (for example the DeepSeek Chat UI geometry the client references).

Every other mention is brand usage and is written as follows: the organization is Centurionarx, the product is arx, the harness is arx Harness. Commit messages follow the same rule; the published history was rewritten message-only as part of this change, and blobs were left untouched so historical content stays byte-identical.

The frozen `.agents/notes/archived/` tree keeps its original wording; archived notes are never rewritten, and their verification accepts the historical naming in the frozen tree.

## Alternatives considered

- **Rename the access identifiers too** (env vars, provider id, model names). Rejected: they name DeepSeek's actual API; renaming them severs the link between the documentation and the service the credentials reach, and breaks every existing `.env`.
- **Change branding only forward, keep the published history.** Rejected by maintainer decision: the commit log is a product surface, and brand mentions in it read as identity. The accepted cost is that existing clones and the old `dsh-*` tags map to rewritten commits and collaborators must re-sync after the forced push.
- **A blanket text replacement across the tree.** Rejected: with no sense classification it would have rewritten the access configuration itself; classification-first replacement was chosen instead.

## Consequences

- A case-insensitive `deepseek` search over the tree returns only access-config surfaces: credential variables and their docs, provider configuration and implementations, third-party notices, and the frozen archive.
- History rewriting invalidates existing clones; PRs referencing old SHAs and the unmapped tags are the known breakage the maintainer accepted.
- Root `AGENTS.md` carries the one-line rule; this note owns the rationale and the keep-classes list.
