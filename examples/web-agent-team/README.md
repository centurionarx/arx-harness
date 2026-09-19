# Agent Teams Web overlay

After building the repository, launch the Web profile with this overlay to compose the existing experimental team service and tools with their roster, task dependencies and teammate navigation.

Run from the repository root: `pnpm arx --profile web --patch examples/web-agent-team/cordis.yml`. Team data remains owned by the existing service and session log. The UI is a read-only projection; it does not create another task executor or promise worktree isolation.

The overlay is optional because these team packages remain private and experimental. The shipped project workspace and explicit deliverables work independently.
