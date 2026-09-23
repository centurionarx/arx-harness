# Upstream Sync

This repository is a fork of an upstream harness. Its first commit reproduces one upstream commit as a snapshot with no shared history, so upstream work cannot be merged: it enters one decision at a time, judged against this tree. This page defines the policy and the manifest that records it; [the sync procedure](cookbook/syncing-from-upstream.md) imports one decision, and [the triage](upstream-triage.md) lists every upstream decision since the fork with its class. The [upstream sync Agent Note](../.agents/notes/implemented/process/2026-09-23-upstream-sync-manifest-and-triage.md) records why.

## Manifest

[`scripts/upstream-sync.manifest.json`](../scripts/upstream-sync.manifest.json) is the only place upstream identifiers are spelled out. This page, the procedure, and the generated triage name them only through the manifest, and [`scripts/upstream-sync-manifest.ts`](../scripts/upstream-sync-manifest.ts) validates it on every read.

| Field | Meaning |
|---|---|
| `repository` | Clone URL of the upstream repository. |
| `forkBase` | The upstream commit whose tree this repository's first commit reproduces. The triage starts after it. |
| `dropPaths` | Upstream paths an import never takes: a `dir/` prefix, a `*.ext` suffix matched against the file name, or one exact path. |
| `corePaths` | Path prefixes the [core rule](#the-core-rule) governs; `*` matches within one path segment. |
| `identifierMap` | Ordered `[upstream, local]` identifier prefixes an import rewrites; the first match wins. |
| `slugRenames` | Whole name segments renamed when an upstream note name is shown or imported here. |
| `forbidden` | Words no generated triage may contain, and that an import may keep only in model-access configuration. |
| `verdicts` | Recorded triage verdicts, keyed by the note name as the triage shows it, without its date prefix. |

## The import unit

One upstream Agent Note with the change that implemented it is one import: the pull request that added the note, plus the later upstream changes that amend the same decision. An import is a cherry-pick of those changes, reduced by the drop list, rewritten through the identifier map, and translated to English. A merge of upstream `master` is never an import.

The imported note keeps its date and its name through `slugRenames`, loses its language switcher, and cites its origin as `upstream PR #N`; the manifest's `repository` resolves the number. Its documents enter the corpus under the `included` rule of [the translation pairing manifest](../scripts/translation-pairing.manifest.json), so the English side lands first and the Portuguese side comes from it, never from an upstream translation.

## Keep list

A sync never overwrites these paths; a conflict on one of them keeps this tree's side and re-homes the upstream change:

- [`packages/llm/llm-agent-cli`](../packages/llm/llm-agent-cli/README.md) and the route presets of [`packages/llm/llm-pi-ai`](../packages/llm/llm-pi-ai/README.md).
- [`packages/examples`](../packages/examples/README.md) and [`examples`](../examples/AGENTS.md).
- [`packages/host/apiproxy`](../packages/host/apiproxy/README.md) and [`packages/client/runtime`](../packages/client/runtime/README.md).
- [`packages/session/session-persistence-sqlite`](../packages/session/session-persistence-sqlite/README.md).
- [`packages/subagent/subagent-arx-sdk`](../packages/subagent/subagent-arx-sdk/README.md), [`packages/subagent/tool-subagent-report`](../packages/subagent/tool-subagent-report/README.md), and [`packages/subagent/claude-agent-sdk-process`](../packages/subagent/claude-agent-sdk-process/README.md).
- [`packages/client/ui-settings-web`](../packages/client/ui-settings-web/README.md) and [`packages/client/ui-exit`](../packages/client/ui-exit/README.md).
- [`packages/test-support/acp-snapshot`](../packages/test-support/acp-snapshot/README.md).
- The brand: product name, wordmark, logo, favicon, and design tokens.
- [`docs/i18n`](i18n/README.md).

## Drop list

The manifest's `dropPaths` names two kinds of upstream path. Packages that exist to reach the upstream's own model vendor as a product — its LLM adapter and request extensions, its account sign-in, its web search, its session-log variant, its SDK subagent, and its plugin inventory — have no counterpart here, because [the vendor is configuration, not a brand](../.agents/notes/implemented/architecture/2026-09-03-the-vendor-is-configuration-not-a-brand.md). Translation sides (`*.zh.md`, `*.i18n.yaml`) never enter: every imported document is English, and its Portuguese side comes from the corpus machinery. An upstream document that names the vendor as a brand is rewritten under the vendor note before it lands.

## The core rule

A change to a `corePaths` source path or to a `SessionEventMap` declaration is imported only when it removes a failure class this repository has, or when another imported change requires it; never when it removes a capability this repository ships without a migration path. Each such import gets its own Agent Note stating which clause admitted it.

## Identifiers and language

An import maps every upstream identifier prefix through `identifierMap`: the package scope, the product prefix, the environment-variable prefix, and the design-token namespaces. An identifier the map does not cover fails the import instead of landing, and the fix is a new map entry. The single exception is the vendor note's: a string that is model-access configuration — a model id, an endpoint, a credential variable — stays byte-identical.

No CJK character survives an import. Strings in code, comments, tests, and locale dictionaries are translated to English before the import lands. [`scripts/check-upstream-import.ts`](../scripts/check-upstream-import.ts) enforces both rules on the staged change: it fails on a drop-listed path, a CJK character, or an unmapped identifier prefix, and lists every line holding a `forbidden` word for a person to confirm as model-access configuration.

## Triage

[`scripts/gen-upstream-triage.ts`](../scripts/gen-upstream-triage.ts) writes [the triage](upstream-triage.md) from a local upstream clone named by `ARX_UPSTREAM_CHECKOUT`. It walks the upstream first-parent history after `forkBase` and lists every Agent Note added under `implemented/`, `proposed/`, or `rejected/`, with the upstream PR number, the commit, and the areas that commit touched. A row never copies upstream titles, branch names, or prose; a name segment `slugRenames` does not cover and `forbidden` catches stops the generator. `doc-sync` does not check the page, because it depends on a checkout outside this repository; the sync procedure regenerates it.

| Class | Meaning | Source |
|---|---|---|
| `present` | A note with the same date and name exists here with the same status. | Mechanical |
| `incorporate` | Import it. | Verdict |
| `evaluate` | Import it only when the core rule admits it; the reason names the condition. | Verdict, or mechanical when the change touches a `corePaths` source path or a `SessionEventMap` declaration |
| `drop` | Never import it; the reason names the kept decision, the absent code, or the fact already true here. | Verdict, or mechanical when every changed path is drop-listed |
| `deferred` | Import it after the decision its reason names. | Verdict |
| `untriaged` | No verdict yet. A reason, when present, records that the note exists here with a different status. | Mechanical |

A recorded verdict wins over every mechanical class except `present`. The generator refuses a verdict that names no upstream note, and a verdict for a note that is already `present`, so an import removes its verdict in the same change.
