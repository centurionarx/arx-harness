# arx-native-accounts

Native Claude Code and Codex account management for Settings. The package installs the official Claude Agent SDK 0.3.281 and Codex 0.156.1 payloads and resolves their platform executables without requiring a global CLI installation. The products own credential persistence; the harness never reads their credential files or copies tokens into settings.

`ctx.nativeAccounts.describe()` runs bounded native status probes and returns connection state, supported login modes, and available native model metadata. Email addresses, account identifiers, tokens, raw stdout, and stderr are excluded. Claude model discovery uses the SDK initialization protocol without submitting a prompt; Codex uses `model/list` and follows its pagination. Codex's server filters that list by the signed-in plan and the client's version, so a model reaches the roster only once the pinned Codex release is new enough for it; 0.147.0 receives no GPT-6 model and 0.156.1 does. Native metadata supplies no inferred context-window capacities.

`begin(provider, mode)` returns an unguessable private attempt id. Only that id can poll, submit a requested code, or cancel the attempt. One attempt per product runs at a time; `maxAttempts` caps active and retained attempts together. Concurrent account-directory requests share one bounded set of probes. Each attempt has a configured deadline and a short terminal-result retention period. Cancellation, expiry, and plugin disposal terminate and await the native process tree. Account listings never contain attempt ids. A reload loses the private capability; the attempt expires automatically.

Claude uses `auth login --claudeai`, relays only an allowlisted HTTPS authorization address, and bridges the pinned CLI's `Paste code here if prompted >` input through a transient Settings field. This supports a browser on another machine while the CLI remains on the host. Codex offers its official app-server browser and device-code modes. A successful CLI exit is followed by native Claude subscription status verification; Codex completion must match the started login id. Login does not submit a paid model request.

The native account RPCs are part of the loopback, same-origin configuration plane, including status reads. A browser connected directly to a public VM address cannot use them; an authenticated local tunnel preserves this restriction. Native Codex login enables the native product account and does not create a direct `llm-pi-ai` credential or a main-chat model route. No endpoint logs out a shared native account.

## Configuration

`cwd` selects the native working directory, and `env` overlays the subprocess service's credential-scrubbed environment. `graceMs` controls process-tree teardown, `outputMaxBytes` bounds collected native output, `probeTimeoutMs` bounds account discovery, `loginTimeoutMs` bounds user sign-in, `resultRetentionMs` bounds terminal-result retention, `maxAttempts` caps retained capabilities, and `pollIntervalMs` supplies the browser's progress refresh interval. Defaults are declared by the plugin schema.

## Model Experience

None, as account status and sign-in are configuration-time interactions with a human, and no status, attempt, or answer reaches a model request or a session log.

#### KV Cache effect

No invalidation; no account state enters a request prefix.

## Known Limitations and Deferred Work

- **Native credentials are the host user's** — the tools store their login under the host's operating-system account, where other installed clients of the same product may share it; this service reads none of it and offers no sign-out.
- **An attempt does not survive a restart** — attempts live in memory, so a host restart or a page reload that loses the attempt id abandons the sign-in until its deadline withdraws the process.
- **Codex browser sign-in returns to the host's loopback** — the Codex app-server serves the sign-in callback at `http://localhost:1455/auth/callback` on the harness host, so a browser on another machine completes that sign-in only through a forwarded port 1455, as the [remote-access guide](../../../docs/user/guide/security.md#remote-access-through-ssh) shows; the host serves one such callback at a time, and device-code sign-in needs none.
- **A connected account configures no route** — listing a tool's models configures nothing; the Claude chat route exists only once the Models page enables it, and a Codex sign-in authorizes the Codex tool, not the library-backed `openai-codex` chat route.
