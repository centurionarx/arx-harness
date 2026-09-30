# Cookbook: syncing one decision from upstream

This guide imports one upstream decision into this tree under [the upstream sync policy](../upstream-sync.md). The policy's manifest names the upstream repository, the fork base, and every rule the steps below apply; the steps read those values from it instead of spelling them out.

## 1. Prepare the upstream clone

Clone the upstream repository beside this one once, and point `ARX_UPSTREAM_CHECKOUT` at it in every shell that runs these steps:

```sh
git clone "$(node -p "require('./scripts/upstream-sync.manifest.json').repository")" ../upstream-harness
export ARX_UPSTREAM_CHECKOUT="$(cd ../upstream-harness && pwd)"
```

Refresh an existing clone with `git -C "$ARX_UPSTREAM_CHECKOUT" fetch origin`.

Verify: this prints `fork base reachable`.

```sh
git -C "$ARX_UPSTREAM_CHECKOUT" merge-base --is-ancestor \
  "$(node -p "require('./scripts/upstream-sync.manifest.json').forkBase")" origin/master && echo 'fork base reachable'
```

## 2. Refresh the triage

```sh
pnpm run gen-upstream-triage
```

The generator rewrites [the triage](../upstream-triage.md) through upstream `origin/master` (`-- --ref <rev>` selects another revision) and prints how many rows are untriaged. Judge the new `untriaged` and mechanical `evaluate` rows: record each verdict in the manifest's `verdicts`, keyed by the name the triage shows, with a reason stated in terms of this tree. Rerun the generator.

Verify: it exits 0, and each row you judged shows its verdict class.

## 3. Read the decision

Pick one `incorporate` row, or an `evaluate` row the [core rule](../upstream-sync.md#the-core-rule) admits. Its Commit column names the upstream commit that landed the note:

```sh
commit=<Commit column>
git -C "$ARX_UPSTREAM_CHECKOUT" diff --stat "$commit^1" "$commit"
git -C "$ARX_UPSTREAM_CHECKOUT" diff --name-only "$commit^1" "$commit" -- .agents/notes
git -C "$ARX_UPSTREAM_CHECKOUT" log --first-parent --format=%h "$commit..origin/master" -- <note path>
```

Read the note and the diff. The last command lists later upstream commits that amend the note; each one joins this import and repeats steps 4 and 5.

## 4. Apply the change without committing

Export the change as a patch without translation sides, and apply what applies:

```sh
git -C "$ARX_UPSTREAM_CHECKOUT" diff --binary "$commit^1" "$commit" -- . \
  ':(exclude,glob)**/*.zh.md' ':(exclude,glob)**/*.i18n.yaml' > "${TMPDIR:-/tmp}/upstream.patch"
git apply --index --reject "${TMPDIR:-/tmp}/upstream.patch"
```

Each hunk that does not apply lands in a `.rej` file beside its target. Port it by hand, keeping this tree's side on a [keep-list path](../upstream-sync.md#keep-list), then delete the `.rej` file.

Verify: `git status --short` lists no `.rej` file.

## 5. Rewrite the change for this tree

1. Remove every path the manifest's `dropPaths` covers; step 6 names any that remain.
2. Map each upstream identifier through the manifest's `identifierMap`; a string that is model-access configuration stays byte-identical.
3. Translate every CJK string in code, comments, tests, and locale dictionaries to Brazilian Portuguese; an upstream `zh` dictionary becomes the `pt` dictionary.
4. Rename the Agent Note file when a segment of its name is in `slugRenames`, delete its language-switcher line, and cite its origin as `upstream PR #N`.
5. Rewrite each relative link to a path that exists here; drop links to translation sides and to dropped packages.
6. Delete the decision's entry from the manifest's `verdicts`.

## 6. Check the import

```sh
pnpm run check-upstream-import
```

Verify: it exits 0, and every `review` line it prints is model-access configuration. A `fail` line names the path or line to fix and the mapping to apply.

## 7. Verify and commit

```sh
pnpm run gen-upstream-triage
pnpm run verify-agent-note-format
pnpm exec tsx scripts/verify-translation-pairing.ts --list
```

Verify: the imported note's row reads `present`, the note format check passes, and `--list` reports a missing Portuguese side only for documents inside the `included` corpus. Run the behavior checks [arx-pre-push-checks](../../.agents/skills/arx-pre-push-checks/SKILL.md) selects for the touched packages, then commit the import with its manifest and triage changes, citing `upstream PR #N` in the message.
