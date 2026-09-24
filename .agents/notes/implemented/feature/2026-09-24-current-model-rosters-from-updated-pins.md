# Agent Note: current model rosters from updated pins

Status: implemented

## Problem

The chat picker did not offer every model a subscription plan includes. A Claude subscription listed no Opus 5.5, and the OpenAI Codex group listed no GPT-6 model.

Each roster comes from a pinned tool:

- **Claude Code account card.** It reads `supportedModels()` from the CLI bundled with `@anthropic-ai/claude-agent-sdk` 0.3.220 (Claude Code 2.1.220), whose `opus` alias still resolved to Opus 5.
- **Codex account card.** It reads the app-server's `model/list`, which the Codex server filters by the signed-in plan and the client's version, and 0.147.0 receives no GPT-6 model.
- **Codex chat route.** The `openai-codex` route serves the installed `@earendil-works/pi-ai` catalog, and 0.82.1 carries no GPT-6 model.

Neither chat route followed its account's roster:

- **Claude.** "Enable in chat" wrote the `claude-subscription` route once and was disabled afterwards. The write also failed validation whenever the roster named a long-context id such as `claude-opus-5-5[1m]`, because [`arx-llm-agent-cli`](../../../../packages/llm/llm-agent-cli/README.md) sized a model only by its exact catalog id.
- **Codex.** The chat route never read the account's roster at all.

## Decision

The Claude Agent SDK is pinned to 0.3.281 (Claude Code 2.1.281) in `arx-native-accounts`, `arx-claude-agent-sdk-process`, `arx-subagent-claude-code`, and `arx-llm-agent-cli`, and its `opus` alias resolves to `claude-opus-5-5`.

- **Unchanged.** The custom-spawn interface that [`arx-claude-agent-sdk-process`](../../../../packages/subagent/claude-agent-sdk-process/README.md) projects (`SpawnOptions`, `SpawnedProcess`), `ModelInfo`, and the four result error subtypes.
- **Changed.** `onElicitation` and `onUserDialog` now also receive a `requestId`. The CLI rejects a plan-mode `ExitPlanMode` call with its new text, "ExitPlanMode is disabled for this session".

`arx-native-accounts` pins `@openai/codex` 0.156.1:

- **Why.** A probe of both releases' `model/list` without a sign-in shows the version gate. 0.147.0 lists `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, and `gpt-5.2`. 0.156.1 adds `gpt-6-astra`, `gpt-6-sol`, and `gpt-6-luna`.
- **Protocol evidence.** The package reads `account/read`, `model/list`, `account/login/start`, and `account/login/completed`. Their schemas, regenerated from both releases, differ only by additions: optional fields, enum values, and a login variant.
- **`arx-subagent-codex` stays on 0.147.0.** Its protocol surface changed: `codexErrorInfo` gains variants beyond the sixteen it pins, the item union is reordered, and approval requests carry a `kind`. [Its README](../../../../packages/subagent/subagent-codex/README.md) requires regenerated evidence and a credentialed run before it moves.

pi-ai is pinned to `^0.87.1` in `arx-llm-pi-ai` and `arx-llm-agent-cli`. Its catalog:

- **Adds GPT-6.** `gpt-6-astra`, `gpt-6-sol`, and `gpt-6-luna` join `openai-codex`, `openai`, and `azure-openai-responses`.
- **Adds Claude models.** `claude-opus-5-5` and `claude-fable-5-1` join `anthropic`, both with a 1,000,000-token window and a 128,000-token output cap.
- **Renames and drops models.** `deepseek-v4-flash` becomes `deepseek-flash` (DeepSeek V4.1 Flash). `gpt-5.4` and `gpt-5.4-mini` leave `openai-codex`, and `claude-opus-4-1` leaves `anthropic`.
- **Adds providers.** `baseten`, `meta`, `qwen-token-plan-individual`, and `radius`.

The compat drift gates that [the wire-compat surface](2026-08-18-pi-ai-wire-compat-surface.md) owns classify pi-ai 0.87's set:

- **Offered.** The `baseten` thinking format and the `thinking.budget` placeholder, because the profile's types must match upstream's unions. `chatTemplateArgs`, the values `baseten` sends as `chat_template_args`, because it plays the part `chatTemplateKwargs` plays for the `chat-template` formats.
- **Withheld because the catalog sets them for a named vendor.** `supportsMidConvoSystemMessages`, `supportsMidConvoToolAdditions`, `supportsMidConvoToolChanges`, `supportsMidConvoEffort`, `supportsAdditionalTools`, `allowedFallbackModels`, and Anthropic's `sessionAffinityFormat`.
- **Withheld because no deployment has needed them.** `supportsFinishReason`, `supportsMaxOutputTokens`, `thinkingTokenBudgetField`, `supportsThinkingTokenBudget`, and `vllmPriority`.
- **Protocol and removals.** `mistral-conversations` has its own gate, which offers nothing. `deferredToolsMode` and `supportsToolReferences`, which pi-ai removed, leave the gates.

Two pi-ai 0.87 behaviors change what the adapter reports:

- **Caller abort.** A caller abort observed before dispatch reaches the adapter as an ordinary `error` event, because pi-ai's credential read refuses the aborted signal and pi-ai turns every setup failure into `stopReason: "error"`. The adapter reports a terminal error that follows the caller's abort as `aborted`, the rule `arx-llm` already applies to a thrown adapter failure.
- **New stop reasons.** A terminal `pending` or `deferred` stop maps to an error with code `PI_AI_ERROR`, because the adapter never requests a deferred response.

Each subscription roster now feeds its chat route through the Models page:

- **Route states.** The native account card compares an account's roster with what its route serves and labels the button **Enable in chat** when the route is missing, **Update chat models** when the route lacks a roster model, and **Enabled in chat** when it serves them all.
- **Claude route.** It lists one entry per roster model under its canonical id. The roster's `default` row takes the name of the row that names the same model directly.
- **Codex route.** It must already exist, because its credential is the separate OpenAI chat authorization. A roster model the pi-ai catalog describes is written by id alone, so it keeps the catalog's metadata. Any other model carries its roster name and the efforts pi-ai can offer.
- **Append only.** An update only appends. A Codex route that serves the catalog is listed explicitly beside the models it gains.

`arx-llm-agent-cli` resolves an id carrying the CLI's `[1m]` suffix to a 1,000,000-token window and takes its output cap and image input from the catalog entry for the id without the suffix.

## Alternatives considered

**pi-ai 0.85.1.** It carries `gpt-6-astra` with `deepseek-v4-flash` intact, but not `gpt-6-sol`, `gpt-6-luna`, or `claude-opus-5-5`, which first ship in 0.87.1. The rename lands in 0.86.0, so no release carries every requested model without it.

**Codex CLI 0.156.1 for `arx-subagent-codex` too.** One payload per install would be tidier, but its changed protocol surface needs the credentialed run that the provider documents, and neither this change's environment nor the CI real-API lane provides one. The default product installs only `arx-native-accounts`, so the second payload appears only in a Profile that also installs the optional Codex subagent Bundle.

**Offering every new compat field.** A field no deployment has asked for would add configuration, documentation, and tests without a consumer, which [the package rules](../../../../packages/AGENTS.md) reject. Withholding one refuses it at resolution with the offered alternatives named, so offering it later is additive.

**Mapping `deferred` to a successful stop.** A deferred response has no final answer yet, so reporting it as a finished turn would record an empty success.

**Syncing a route whenever the page loads.** The roster is read only when the Models page opens, so a silent write there would change stored settings without an action. The explicit button makes the same write on request.

**Replacing a route's list with the roster.** An operator may have added models or tuned fields on existing entries, and a replacement would drop them. Appending keeps both, at the cost that a model the plan drops stays listed until someone removes it.

**Feeding the Codex route without the chat authorization.** A route created from the native roster would list models whose requests fail for want of the chat grant, so the card waits for the authorization that creates the route.

**Reading the Codex plan through pi-ai.** pi-ai's `openai-codex` provider serves a static catalog and implements no model listing, so only the Codex app-server knows what the plan offers.

## Consequences

- **Rosters.** The Claude account card lists Opus 5.5 and its long-context variant, and the Codex card lists the GPT-6 models the plan allows. One click brings either chat route up to its roster, and the chat picker's Codex group already shows the three GPT-6 models the catalog describes.
- **Removed models.** A setting or session that selected `deepseek-v4-flash` on pi-ai's `deepseek` catalog route, `gpt-5.4` or `gpt-5.4-mini` on `openai-codex`, or `claude-opus-4-1` on `anthropic` no longer resolves and must select a model the catalog still ships. Hand-declared routes, such as the examples' `deepseek-official`, list their own models and are unaffected.
- **Explicit Codex list.** After an update, the Codex route lists its models explicitly, so a later catalog addition reaches it only through its list, which the next update extends.
- **Request changes.** The catalog now gives the `deepseek` entries `max_tokens` as their output-cap field and strict tool schemas, so requests on that catalog route change accordingly.
- **Duplicate installs.** `@anthropic-ai/claude-agent-sdk@0.3.281` installs in two peer variants. `arx-subagent-claude-code` pins `@anthropic-ai/sdk` 0.93.0, while other importers resolve the peer to the 0.124.0 that pi-ai brings, and both variants share one platform payload. A Profile with the Codex subagent Bundle carries Codex 0.147.0 beside 0.156.1.

## Testing

`arx-llm-pi-ai`, `arx-llm-agent-cli`, and `arx-client-ui-settings-models` keep 100% coverage:

- **Catalog-dependent unit tests.** Cases that relied on `deepseek-v4-flash` use `deepseek-v4-pro`, which keeps their premises of a text-only model offering `off`, `high`, and `max`. The mixed-protocol cases use `opencode-go` in place of `xai`, and the catalog-capacity cases use `claude-opus-5-5`.
- **pi-ai adapter cases.** New cases cover `chat_template_args` on the wire under `baseten` with `thinking.budget`, a withheld new switch, the `pending` and `deferred` stop reasons, and the pre-dispatch caller abort.
- **Roster cases.** The client cases cover roster entries, every route state for both products, the append-only update, the Codex catalog read, and the `[1m]` sizing.

Two probes support the Codex decision:

- **Model lists.** Both releases' `model/list`, without a sign-in, show the version gate the Decision describes.
- **Account status.** The opt-in native account smoke reads account status through the 0.156.1 app-server.

The Claude Code real-product tests run the bundled 2.1.281 CLI against the loopback Messages fixture. Inside a cloud Claude Code container, that CLI prefers the container's own session credential over `ANTHROPIC_API_KEY` and refuses `bypassPermissions` for root. There they pass only with the container's `CLAUDE_*` and `ANTHROPIC_*` variables unset and `IS_SANDBOX=1`. CI runners have neither condition.

The Models settings and first-run guide web goldens list the four new catalog providers, 41 in place of 37, and the native account card's introduction. The web lane unmounts native accounts because their status depends on the host, so the roster buttons have component coverage rather than an assembled golden.
