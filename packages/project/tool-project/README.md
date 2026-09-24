# `@arx-ai/arx-tool-project`

This package registers one action-based `project` tool over `ctx.projects`. The model can create and inspect projects, save plan revisions and observe trusted-operator approval, advance task state, save and render versioned prompts, and drive bounded persisted workflows through an optional owned-subagent runner or one explicit step at a time.

Mutations require the exact `expected_version` returned by the latest read. The tool returns the complete committed aggregate. `render_prompt` returns the rendered text and full selected skill snapshots; the ordinary tool result therefore records the effective input without private prompt injection.

`start_workflow` reserves work against the current exact approved plan and binds the run to the actual calling agent; a model cannot supply another parent session. `execute_workflow` delegates the saved run to the optional project runner. Manual execution uses `claim_workflow_step`, launches a direct child from that same parent in the project workspace, registers its session with `attach_workflow_step_session` (`run_id`, `step_id`, `session_id`), and calls `settle_workflow_step` after the child finishes. Claims, attachments, settlements, and reconciliation reject another calling session. Child sessions do not need to appear as top-level workspace sessions. `uncertain` restart state always requires explicit reconciliation before claiming more work.

`save_prompt` accepts `purpose`, `tags`, `examples`, and `evaluation_cases`. `start_prompt_evaluation` binds the current approved plan and actual calling agent; `execute_workflow` runs child sessions and `finalize_prompt_evaluation` persists comparable results. Truncated output remains inconclusive and token totals remain null when usage is incomplete.

## Model Experience

### Project orchestration tool

#### What the model sees

The configured tool name, default `project`, exposes the action-specific schema and the durable orchestration rules in its tool description. A system-prompt section instructs the model to read before compare-and-set mutations, wait for trusted-operator approval and require evidence, render prompts before use, and explicitly drive workflow steps.

#### Token effect

The tool schema and guidance are fixed request context. Tool results add only the project or prompt data requested by the model; effective prompt snapshots include full selected skill content and are not separately truncated by this package.

#### KV Cache effect

The fixed tool schema and guidance preserve a stable prefix while the plugin configuration is unchanged. Project reads and mutations append data-dependent tool results after that prefix.

## Known Limitations and Deferred Work

- **Single action schema** — action-specific payload fields are carried in the `input` JSON object, so the model must follow the formats stated by each operation and correct validation errors returned by the executor.
- **Foreground driver required** — `execute_workflow` requires the optional project runner and the original parent session to remain active. Manual claims require the caller to execute and settle each step. No background scheduler automatically resumes a saved run.


save_prompt accepts purpose, 	ags, xamples, and valuation_cases. start_prompt_evaluation binds the current approved plan and actual calling agent, then xecute_workflow runs real children and inalize_prompt_evaluation persists deterministic comparable results. Truncated child output remains inconclusive and token totals remain null when usage is incomplete.
