# Agent Note: Restated intent, finding resolution, and documentation drift checks

Status: implemented

## Problem

The [arx-code-review](../../../skills/arx-code-review/SKILL.md) skill asks the reviewer to confirm that the implementation matches the PR, but it does not require the reviewer to state the PR's intent first, so a reviewer who misreads the change can report findings against the wrong goal. Its guidance for receiving review says to fix or rebut each claim, but it does not say what evidence a rebuttal needs, who decides a disagreement that remains, or whether a resolved finding can be raised again, so a thread can repeat the same argument across review rounds.

The [arx-doc-standards](../../../skills/arx-doc-standards/SKILL.md) corpus audit finds duplication, leaked reasoning, and budget outliers, and the `pnpm run doc-sync` gates listed in [scripts/run-gates.ts](../../../../scripts/run-gates.ts) are deterministic checks. Neither step judges whether a documented statement about behavior, defaults, or commands is still true.

## Decision

The arx-code-review manual checks start with a restatement. Before judging the diff, the reviewer writes a two-sentence summary of what the PR changes and why and opens the PR-level review comment with it, so the author can correct a misreading. When the diff, PR description, and linked design do not support that summary, the missing or contradictory intent is the first finding.

The arx-code-review reporting section states three resolution rules. A party contests a finding only with evidence the other party can read in the thread, such as a test result, a log excerpt, or a code location. When author and reviewer still disagree after that evidence is posted, the repository owner decides. A finding resolved by a fix or by an accepted rebuttal stays closed unless new evidence appears.

The arx-doc-standards corpus audit has an optional seventh step. The auditor compares documented claims about behavior, configuration, defaults, commands, and paths with the owning source and records only false or outdated claims; internal detail that a document omits is not drift. The step complements the `doc-sync` gates and never replaces them.

The three practices are adapted from the Apache-2.0 [elephant-goldfish-model](https://github.com/google/elephant-goldfish-model) project at commit `0f06dd72`: its comprehension reviewer paraphrases a design document before critiquing it, its resolution step contests, escalates, or declines findings, and its drift report compares designs with code. This repository applies the first practice to PRs. The wording in this repository is original. No text, agent definition, script, or plugin from that project is copied or installed.

The [periodic human-review maintenance workflow](2026-07-13-human-review-skill-maintenance.md) promotes arx-code-review guidance only from human feedback adopted in merged PRs, so this change enters through ordinary repository review. That workflow stays in force, and its promotion rules apply unchanged to any candidate built against the previous skill version.

## Alternatives considered

**Install the elephant-goldfish-model plugin.** Rejected because its agent definitions, scripts, and update path need source review on every upstream change, and its review loop duplicates the arx-code-review workflow. The three adopted practices fit in existing skill sections without new tooling.

**Copy its reviewer agents into `.agents/`.** Rejected because those agents depend on that project's orchestration and output formats. Copied text also requires Apache-2.0 attribution and creates a second owner for review guidance that arx-code-review already owns.

**Make the drift check a required audit step or a `doc-sync` gate.** Rejected because deciding whether prose is true requires reading the owning source semantically. A deterministic gate cannot make that decision, and a required step would make every small documentation audit expensive.

**Wait for the periodic maintenance workflow to propose these rules.** Rejected because that workflow promotes only guidance adopted from human review feedback on merged PRs. It does not import methods from outside the repository.

## Consequences

Every review opens with a two-sentence restatement before findings. A PR whose intent is unclear receives an intent finding before code findings, which can delay review of correct code. In exchange, a reviewer's misreading becomes visible before other findings depend on it.

The repository owner becomes the decision point for review disputes that evidence does not settle, which adds owner work. In exchange, settled findings stop returning in later review rounds unless someone posts new evidence.

The optional drift pass costs source reading proportional to the audited scope. It can find false claims that no documentation gate detects. Later changes to the upstream project reach this repository only through a new review.

## Verification

No automated test pins this guidance. `doc-sync` checks the skills' links and invocation metadata and this note's format, not how reviewers apply the text. Whether reviewers follow the restatement and resolution rules is observable only in review threads.
