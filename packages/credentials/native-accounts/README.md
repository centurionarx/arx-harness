# arx-native-accounts

Native Claude Code and Codex account management for Settings. The package installs the official Claude Agent SDK 0.3.220 and Codex 0.147.0 payloads and resolves their platform executables without requiring a global CLI installation. The products own credential persistence; the harness never reads their credential files or copies tokens into settings.

`ctx.nativeAccounts.describe()` runs bounded native status probes and returns connection state, supported login modes, and available native model metadata. Email addresses, account identifiers, tokens, raw stdout, and stderr are excluded. Claude model discovery uses the SDK initialization protocol without submitting a prompt; Codex uses `model/list` and follows its pagination. Native metadata supplies no inferred context-window capacities.

`begin(provider, mode)` returns an unguessable private attempt id. Only that id can poll, submit a requested code, or cancel the attempt. One attempt per product runs at a time; `maxAttempts` caps active and retained attempts together. Concurrent account-directory requests share one bounded set of probes. Each attempt has a configured deadline and a short terminal-result retention period. Cancellation, expiry, and plugin disposal terminate and await the native process tree. Account listings never contain attempt ids. A reload loses the private capability; the attempt expires automatically.

Claude uses `auth login --claudeai`, relays only an allowlisted HTTPS authorization address, and bridges the pinned CLI's `Paste code here if prompted >` input through a transient Settings field. This supports a browser on another machine while the CLI remains on the host. Codex offers its official app-server browser and device-code modes. A successful CLI exit is followed by native Claude subscription status verification; Codex completion must match the started login id. Login does not submit a paid model request.

The native account RPCs are part of the loopback, same-origin configuration plane, including status reads. A browser connected directly to a public VM address cannot use them; an authenticated local tunnel preserves this restriction. Native Codex login enables the native product account and does not create a direct `llm-pi-ai` credential or a main-chat model route. No endpoint logs out a shared native account.

## Configuration

`cwd` selects the native working directory, and `env` overlays the subprocess service's credential-scrubbed environment. `graceMs` controls process-tree teardown, `outputMaxBytes` bounds collected native output, `probeTimeoutMs` bounds account discovery, `loginTimeoutMs` bounds user sign-in, `resultRetentionMs` bounds terminal-result retention, `maxAttempts` caps retained capabilities, and `pollIntervalMs` supplies the browser's progress refresh interval. Defaults are declared by the plugin schema.

## Model Experience

None. Account controls are configuration-time human interactions and never enter agent prompts or session logs.

### KV Cache effect

None; account status and login progress are not model context.

## Known Limitations and Deferred Work

Native credentials belong to the host's operating-system user and may be shared with its installed product clients. Login attempts do not survive a host restart, and this service provides no logout action. Available native models do not guarantee that a separate harness model route is configured.
