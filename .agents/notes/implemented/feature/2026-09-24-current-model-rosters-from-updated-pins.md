# Agent Note: current model rosters from updated pins

Status: implemented

## Problem

A Claude subscription listed no Opus 5.5, and the chat picker's OpenAI Codex group listed no GPT-6 model. Both rosters come from pinned tools. The Claude account card and its "Enable in chat" action read `supportedModels()` from the CLI bundled with `@anthropic-ai/claude-agent-sdk` 0.3.220 (Claude Code 2.1.220), whose `opus` alias still resolved to Opus 5. The `openai-codex` chat route serves the installed `@earendil-works/pi-ai` catalog, and 0.82.1 carries no GPT-6 model. [`arx-llm-agent-cli`](../../../../packages/llm/llm-agent-cli/README.md) also takes a canonical Claude model's context window, output cap, and image input from pi-ai's `anthropic` catalog, which had no `claude-opus-5-5`.

## Decision

The Claude Agent SDK is pinned to 0.3.281 (Claude Code 2.1.281) in `arx-native-accounts`, `arx-claude-agent-sdk-process`, `arx-subagent-claude-code`, and `arx-llm-agent-cli`. The CLI's `opus` alias resolves to `claude-opus-5-5`. The custom-spawn interface that [`arx-claude-agent-sdk-process`](../../../../packages/subagent/claude-agent-sdk-process/README.md) projects (`SpawnOptions`, `SpawnedProcess`), `ModelInfo`, and the four result error subtypes are unchanged. `onElicitation` and `onUserDialog` now also receive a `requestId`. The CLI rejects a plan-mode `ExitPlanMode` call with its new text, "ExitPlanMode is disabled for this session".

pi-ai is pinned to `^0.87.1` in `arx-llm-pi-ai` and `arx-llm-agent-cli`. Its catalog adds `gpt-6-astra`, `gpt-6-sol`, and `gpt-6-luna` to `openai-codex`, `openai`, and `azure-openai-responses`, and adds `claude-opus-5-5` and `claude-fable-5-1` to `anthropic`, both with a 1,000,000-token window and a 128,000-token output cap. It renames `deepseek-v4-flash` to `deepseek-flash` (DeepSeek V4.1 Flash), drops `gpt-5.4` and `gpt-5.4-mini` from `openai-codex` and `claude-opus-4-1` from `anthropic`, and adds the `baseten`, `meta`, `qwen-token-plan-individual`, and `radius` providers.

The compat drift gates that [the wire-compat surface](2026-08-18-pi-ai-wire-compat-surface.md) owns now classify pi-ai 0.87's set:

- **Offered.** The `baseten` thinking format and the `thinking.budget` placeholder, because the profile's types must match upstream's unions. `chatTemplateArgs`, the values `baseten` sends as `chat_template_args`, because it plays the part `chatTemplateKwargs` plays for the `chat-template` formats.
- **Withheld because the catalog sets them for a named vendor.** `supportsMidConvoSystemMessages`, `supportsMidConvoToolAdditions`, `supportsMidConvoToolChanges`, `supportsMidConvoEffort`, `supportsAdditionalTools`, `allowedFallbackModels`, and Anthropic's `sessionAffinityFormat`.
- **Withheld because no deployment has needed them.** `supportsFinishReason`, `supportsMaxOutputTokens`, `thinkingTokenBudgetField`, `supportsThinkingTokenBudget`, and `vllmPriority`.
- **Protocol and removals.** `mistral-conversations` has its own gate, which offers nothing. `deferredToolsMode` and `supportsToolReferences`, which pi-ai removed, leave the gates.

Two pi-ai 0.87 behaviors change what the adapter reports:

- **Caller abort.** A caller abort observed before dispatch reaches the adapter as an ordinary `error` event, because pi-ai's credential read refuses the aborted signal and pi-ai turns every setup failure into `stopReason: "error"`. The adapter reports a terminal error that follows the caller's abort as `aborted`, the rule `arx-llm` already applies to a thrown adapter failure.
- **New stop reasons.** A terminal `pending` or `deferred` stop maps to an error with code `PI_AI_ERROR`, because the adapter never requests a deferred response.

`@openai/codex` stays at 0.147.0. The chat picker's Codex group comes from pi-ai, so the Codex CLI pin affects only the native Codex account card's model list and [`arx-subagent-codex`](../../../../packages/subagent/subagent-codex/README.md), whose README requires regenerated schema evidence and a credentialed real-model run before it leaves the verified 0.147.0 protocol.

## Alternatives considered

**pi-ai 0.85.1.** It carries `gpt-6-astra` with `deepseek-v4-flash` intact, but not `gpt-6-sol`, `gpt-6-luna`, or `claude-opus-5-5`, which first ship in 0.87.1. The rename lands in 0.86.0, so no release carries every requested model without it.

**Codex CLI 0.156.1 in the same change.** It lists GPT-6 on the native account card, but leaving the verified protocol baseline needs the credentialed run that `arx-subagent-codex` documents, and neither this change's environment nor the CI real-API lane provides one. Pinning only `arx-native-accounts` would install a second native payload of roughly 275 MB per platform.

**Offering every new compat field.** A field no deployment has asked for would add configuration, documentation, and tests without a consumer, which [the package rules](../../../../packages/AGENTS.md) reject. Withholding one refuses it at resolution with the offered alternatives named, so offering it later is additive.

**Mapping `deferred` to a successful stop.** A deferred response has no final answer yet, so reporting it as a finished turn would record an empty success.

**Refreshing an existing `claude-subscription` route automatically.** The route stores the models written when it was enabled, and changing that is a product decision beyond a dependency update. The route's editor can fetch the new roster, and deleting the route re-enables "Enable in chat".

## Consequences

- **Rosters.** The Claude account card lists Opus 5.5, and a newly enabled `claude-subscription` route serves it with the catalog's capacities. The chat picker's OpenAI Codex group lists the three GPT-6 models. A route enabled earlier keeps its stored list until it is edited or recreated.
- **Removed models.** A setting or session that selected `deepseek-v4-flash` on pi-ai's `deepseek` catalog route, `gpt-5.4` or `gpt-5.4-mini` on `openai-codex`, or `claude-opus-4-1` on `anthropic` no longer resolves and must select a model the catalog still ships. Hand-declared routes, such as the examples' `deepseek-official`, list their own models and are unaffected.
- **Request changes.** The catalog now gives the `deepseek` entries `max_tokens` as their output-cap field and strict tool schemas, so requests on that catalog route change accordingly.
- **Duplicate SDK copy.** `@anthropic-ai/claude-agent-sdk@0.3.281` installs in two peer variants: `arx-subagent-claude-code` pins `@anthropic-ai/sdk` 0.93.0, and other importers resolve the peer to the 0.124.0 that pi-ai now brings. Both variants share one platform payload.

## Testing

`arx-llm-pi-ai` and `arx-llm-agent-cli` keep 100% coverage against the new catalog. Unit tests that relied on `deepseek-v4-flash` use `deepseek-v4-pro`, which keeps their premises of a text-only model offering `off`, `high`, and `max`. The mixed-protocol cases use `opencode-go` in place of `xai`, and the catalog-capacity cases use `claude-opus-5-5`. New cases cover `chat_template_args` on the wire under `baseten` with `thinking.budget`, a withheld new switch, the `pending` and `deferred` stop reasons, and the pre-dispatch caller abort.

The Claude Code real-product tests run the bundled 2.1.281 CLI against the loopback Messages fixture. Inside a cloud Claude Code container, that CLI prefers the container's own session credential over `ANTHROPIC_API_KEY` and refuses `bypassPermissions` for root. There they pass only with the container's `CLAUDE_*` and `ANTHROPIC_*` variables unset and `IS_SANDBOX=1`. CI runners have neither condition.

The Models settings and first-run guide web goldens list the four new catalog providers, 41 in place of 37.
