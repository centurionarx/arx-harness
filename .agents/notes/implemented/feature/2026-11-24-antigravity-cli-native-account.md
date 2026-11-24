# Agent Note: Antigravity CLI as a native account

Status: implemented

## Problem

[Native product accounts](2026-09-24-native-account-and-chat-sign-in.md) let a person sign in to Claude Code and Codex through each vendor's official program, which keeps the credential; the harness never reads a credential file or copies a token. The owner asked for the same sign-in for Google's plans. Since 18 June 2026 the Gemini CLI no longer serves Google AI Pro, AI Ultra, or unpaid individual accounts ([Google announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)), and it has no sign-in command, no status command, and no model listing outside its interactive interface. Its official successor for those plans is the Antigravity CLI (`agy`), which installs from a script outside any package manager and updates itself on every run.

## Decision

`@arx-ai/arx-native-accounts` adds a third driver, `antigravity`, beside the Claude Code and Codex drivers in `src/drivers.ts`. The deployment names the installed executable with the `antigravityExecutable` config field, which must be an absolute path; without it, or when the file is missing, the account reports `unavailable` and starts no process.

Status and models both come from `agy models`, which needs no model turn. Exit code 0 is a signed-in account; each stdout line whose first token is a model id (a lowercase token holding a hyphen or a digit) names one model, and the rest of the line is its display name, while other lines, such as headers, are skipped. Exit code 1 with `Please sign in to view available models.` on stderr is a signed-out account. Any other result rejects the probe, which the manager reports as `unknown`. A zero exit whose listing names no model rejects the probe, so a changed listing format or an executable that is not `agy` reads as `unknown` instead of as a signed-in account without models.

Sign-in runs `agy acp --login`. The driver relays only `accounts.google.com` addresses and answers the CLI's `Then paste the authorization code, or the full URL of the page you land on, and press Enter:` prompt with the person's pasted line. The CLI exits with code 1 on a rejected code, which fails the attempt; a zero exit must be followed by a signed-in `agy models`. The Claude and Antigravity drivers share this terminal sign-in loop as `codePromptSignIn`; each driver supplies its command, relayed hosts, prompt text, and confirmation.

The Web Models card lists Antigravity with its models and sign-in. It offers no chat route: `CHAT_ROUTES` covers only `ChatRouteProvider` (`claude-code` and `codex`), and the card states that arx has no chat route for the product.

The status text, the sign-in prompt, the rejected-code message, and the four ACP authentication methods were observed on Antigravity CLI 1.5.16 (Linux x64, SHA-512 checked against the official release manifest), run with an isolated home directory and no account. The signed-in `agy models` format is not documented and was not observed, and neither was a successful sign-in; `agy acp --help` describes `--login` as signing in and then exiting.

## Alternatives considered

**Gemini CLI.** It fits none of the four requirements for these plans: it no longer serves the personal plans, signs in only through the interactive `/auth` dialog, reports no sign-in state, and lists models only interactively.

**Status through ACP `session/new`.** Without credentials it answers `-32000 Authentication required`, and its response would carry a typed model list. With credentials it creates a conversation in the person's Antigravity history on every Models page load, so the driver uses `agy models` instead.

**A pinned npm dependency, as for Claude Code and Codex.** No official npm package exists (the `agy` and `antigravity-cli` names on npm belong to third parties), and the CLI replaces itself in place on every run, so no pin would hold.

**Looking `agy` up on `PATH`.** The Claude and Codex drivers never fall back to `PATH`; an explicit, validated path keeps the executable a deployment choice that fails loud when it is relative.

**A chat route through `agy -p` or ACP.** Both run the CLI's own tools; neither returns tool calls to the caller. A route would let model-visible tool work escape the session log, so the product lists models only.

**A harness-run OAuth client for Google accounts.** It would copy tokens into harness storage and reuse a credential issued to another program; the Antigravity terms name using its OAuth from third-party software as a breach.

## Consequences

A person can sign in to the Antigravity CLI and see their plan's models in Settings without arx holding any Google credential, and without a paid model request.

The listing format, the status text, and the prompt text can change in any self-update without a version change in arx; the fixtures pin the 1.5.16 texts, so a changed text fails in a person's session, not in CI. A changed signed-out diagnostic or an unrecognized listing reads as `unknown`, and a changed sign-in prompt leaves the attempt waiting until `loginTimeoutMs` expires it; a listing that changes but still starts its lines with model-like tokens is read as models, and so is the output of a misnamed executable that does the same. `ARX_NATIVE_ACCOUNTS_SMOKE=1 ARX_NATIVE_ACCOUNTS_AGY=<path>` runs the real-product smoke against an installed `agy`, which is the only check of the signed-in listing.

Every probe starts `agy`, which writes its data under `~/.gemini/antigravity-cli` and may start its background self-update.

The Antigravity terms (section 6) treat using the service "in connection with products not provided by us" as a breach that may suspend the account. The owner accepted that risk for this driver on 2026-11-24, and limited it to sign-in and model listing.
