# `@arx-ai/arx-skill-git`

This provider exposes skills from exact Git commit object ids. Each project configuration names its workspace cwd, repository, 40-hex commit, and selected discovery directories. The provider materializes only regular blobs and delegates Markdown discovery and frontmatter parsing to `@arx-ai/arx-skill-filesystem`.

The immutable cache key includes the repository, commit, and selected paths. Every cache hit rechecks its manifest, regular-file type, byte count, and SHA-256 content digests. A verified exact-commit cache remains usable while the source is offline. Branches, tags, and other moving refs are rejected.

`ctx.skillGit.snapshot()` reads explicitly named files and returns repository, commit, path, full content, and `sha256:` digest for project prompt provenance. Git and GitHub CLI children run without a shell, discard stderr, never execute checkout hooks or repository scripts, and are aborted and awaited during plugin disposal. Cancellation and output-limit failures remain pending until the child and its streams close, preserving the first failure.

## Model Experience

Indirectly, through the existing skill catalog and loading experience, Git-backed skills are available to the model. The project tool's `snapshot_skills` action returns exact source material through an ordinary logged tool result before it is saved into an immutable prompt revision.

#### KV Cache effect

Catalog entries follow the existing skill provider ordering. Source bodies appear only when a skill or explicit snapshot is loaded.

## Known Limitations and Deferred Work

- Remote repositories are restricted to `github.com` HTTPS or SSH forms; absolute local repositories support development and offline tests.
- Configured project routing matches the resolved workspace cwd exactly.
