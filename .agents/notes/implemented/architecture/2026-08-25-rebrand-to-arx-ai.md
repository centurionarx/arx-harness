# Agent Note: rebrand from arx Harness to arx Harness

Status: implemented

## Problem

The harness shipped under DeepSeek's product identity: npm scope `@arx-ai`, package and binary prefix `arx`, environment prefix `ARX_`, Python module `arx_harness`, and the `arx-ai/arx-harness` repository. The product now ships as arx and needs its own identity across every one of those surfaces.

A blind rename destroys the product it renames. Of the 29,604 case-insensitive `deepseek` spans in the tree, roughly 5,900 do not name the harness at all: they name the DeepSeek *model*, *provider*, *credential*, or *endpoint* that `arx-llm-deepseek` still speaks to. `DEEPSEEK_API_KEY`, `deepseek-official`, the `deepseek-v4` model ids, and `api.deepseek.com` are third-party facts, not branding.

Two further span families look like the product and are not. The `arx-harness` GitHub organization is a third party here — it hosts the forks whose commits [`vendor/README.md`](../../../../vendor/README.md) pins, and the pull requests the notes cite. And the archived Agent Note tree is frozen by [the archive policy](../../README.md), so its file names keep the old prefix while every link *into* it lives in a file the rewrite does touch.

## Decision

Identity is `@arx-ai` (npm scope), `arx` (package and binary prefix), `ARX_` (environment prefix), `arx_harness` (Python module), and `github.com/centurionarx/arx-harness`. The npm scope and the GitHub owner are independent fields and differ: `arx-ai` on npm, `centurionarx` on GitHub. The classifier anchors its owner rule to the GitHub host, because an unanchored one also claims a bare occurrence of the scope literal — invisibly, for as long as the two fields agree.

[`scripts/rebrand.ts`](../../../../scripts/rebrand.ts) is the reproducible source of truth, and it is a **classifier, not a substitution**. Protected spans are masked before any rewrite rule runs and restored afterwards, so no rule can reach them whatever its order. [`scripts/rebrand.spec.ts`](../../../../scripts/rebrand.spec.ts) pins both directions: what must move, and what must survive untouched.

The classifier preserves, in addition to the model and provider spans: `github.com/arx-harness/<repo>` for every repository except this product's own clone URL in [`native/`](../../../../native/README.md), which follows the product; the `arxharness/` fixture in the issue-management policy test; and every relative link naming a file under `archived/`.

The MIT notice keeps `Copyright (c) 2026 DeepSeek` and adds `Copyright (c) 2026 arx` below it, as a derivative must.

Word boundaries are the wrong tool for the prefix rules and are deliberately absent from them. `_` and digits are word characters, so `\b` hides `__ARX_BOOT__`, `_arxWebServer`, `_arx_base_agent`, the `\0arx-css:` virtual-module prefixes, the Python distributions that extend the module name, and `arx Harness` wherever an escaped `\n` puts a letter against it inside JSON. Excluding only letters reaches all of them.

## The acceptance invariant

After the rewrite, a search for the old identity returns **exactly** the preserved set and nothing else. The residual count is 83 spans in third-party GitHub URLs plus 2 in the policy fixture; the preserved DeepSeek provider surface is about 5,900 spans. More than that means product identity leaked through; less means the provider was destroyed.

Generated catalogs slugify `@scope/prefix-name` into anchors by dropping `@` and `/`, so scope and prefix fuse into one token that hand-written docs link to. The classifier rewrites that fused token with the same rule the generator would produce, which is why `website:build` finds no dead anchor after regeneration.

## Alternatives considered

**`sed` over the tree.** Rejected: about a fifth of the matches must survive, and no ordering of blind substitutions distinguishes them. The masking pass exists precisely because rule order cannot be trusted to.

**Keeping the `arx` prefix.** It reads as an abbreviation rather than a brand, so it looked cheap to leave. Rejected: `arx` *means* arx Harness, and a prefix that silently keeps the old product's initials is worse than either extreme — it is neither the old identity nor the new one.

**Renaming the archived notes with everything else.** Rejected: archived notes are the frozen record of what was decided under the old name, and rewriting them falsifies that record. The cost is an asymmetry — links into `archived/` name files whose prefix no longer matches the tree around them — which the classifier now protects explicitly.

**A second corrective pass over the already-rewritten tree.** The first run used the wrong npm scope and owner. Rejected in favour of re-running the corrected classifier from the original commit, so the tree is provably one transformation of a known input rather than two stacked ones.

## Consequences

`$ARX_HOME` becomes `$ARX_HOME`, so existing sessions, credentials, and settings are orphaned. The [pre-release stance](../../../../CLAUDE.md) permits this — backends reject old on-disk formats — and `SESSION_FORMAT_VERSION` does not move, because a rebrand changes no log structure.

Configuration naming the GitHub organization is beyond what the classifier can decide. The upstream organization was named for the product, so a bare organization literal in JSON is indistinguishable from the product slug and the slug rule takes it — which is how `.github/issue-management/config.json` came to name an organization that does not exist, and why the issue-policy job called `repos/arx-harness/arx-harness`. Anchoring the owner rule does not reach this: there is no host beside the value to anchor to. After a rename, organization-shaped configuration is checked by hand.

Publication now depends on owning the `@arx-ai` npm scope and the `arx-harness-sdk` PyPI name; neither is a code change.

A rename this wide is not rebasable. It landed alone, and a conflict is cheaper to resolve by re-running the classifier over the new base than by hand.

Stale `lib/` output survives a rename and breaks the build with a `MISSING_EXPORT` for a symbol that no longer exists under that name. `pnpm run clean` is part of the rename, not an optional follow-up — and it refuses to run while a renamed package directory still holds untracked build residue.

## Related

[The repository naming contract](2026-08-11-repository-naming-contract-and-rename-ledger.md) owns the rules a name must satisfy; this note owns one application of them. [Mandatory app attribution headers](2026-06-21-mandatory-app-attribution-headers.md) owns `APP_IDENTITY`, whose `product` and `url` this change moves — the `User-Agent` every provider request sends is externally observable, so the rebrand is not purely cosmetic.
