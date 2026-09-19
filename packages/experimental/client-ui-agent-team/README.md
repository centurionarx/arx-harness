# @arx-ai/arx-experimental-client-ui-agent-team

Optional read-only Web overlay for `@arx-ai/arx-experimental-agent-team`. It contributes one conversation-header action when the current Session is the Team lead or a member and the optional `agentTeam` projection contains roster or task data. Compositions without the experimental backend retain the existing header unchanged.

The roster distinguishes the lead from teammates and combines durable provisioning or failure phase with current Session presence. The task view shows owner, dependency ids, blockers, and readiness from the durable task DAG. It excludes deleted task tombstones and offers no mutation controls.

Selecting the lead opens its Session through the public client Session store. Selecting a teammate refreshes the lead's subagent catalog, opens the public subagent address when available, and falls back to the teammate Session id when the child is not currently represented in that catalog.

## Model Experience

None, as the overlay visualizes the Team projection and does not add messages, prompt sections, tools, or provider requests.

#### KV Cache effect

Navigation and rendering never assemble model input.

## Known Limitations and Deferred Work

- This package is experimental and read-only. Team mutation remains in the existing Team service and tool package.
- Live running state is process-local. A durable active member without a resident Session is shown as inactive.
- The task graph is a compact dependency list rather than an editable visual graph.
