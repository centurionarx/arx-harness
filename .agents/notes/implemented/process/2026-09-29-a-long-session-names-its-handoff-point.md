# Agent Note: A long session names its handoff point

Status: implemented

## Problem

An agent session that carries many pull requests accumulates context until it is compacted, sometimes several times. Each compaction replaces detail with a summary, so later work in the same session can lose earlier decisions, file states, and owner instructions, and the owner cannot see when that starts. One session on this repository carried more than ten pull requests through several compactions before anyone weighed splitting it.

## Decision

**The agent checks the session's length at its start and after each context compaction.** A session is long once its context has been compacted or it has carried three or more pull requests.

**A long session names the best point to continue in a new one.** That point comes when no work is in flight: every pushed change validated, each open pull request green or its blocker reported, and the next multi-PR task not yet started. The agent tells the owner in the owner's reply language.

**The agent leaves a handoff summary in its reply.** The summary lists the open pull requests with their head commits and CI states, the owner decisions still pending, the standing instructions the owner gave in chat, and the next steps, so a new session starts from it without the old transcript.

## Alternatives considered

**Leave splitting to the owner.** The owner cannot see compaction or the context the agent has lost; the agent can.

**Split at a fixed number of turns.** A turn count does not track context size; compaction and the pull-request count do.

## Consequences

- A session that is already long names its handoff point in its next reply.
- The handoff summary is chat output, not a repository file.
