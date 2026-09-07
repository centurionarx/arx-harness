# Agent Note: the pwsh host waits for a cursor report

Status: implemented

## Problem

Every persistent pwsh session on Linux and macOS produced the same tool result: the scrollback-limit notice, the echoed bootstrap, and a clipping notice, never the command's output. The committed `persistent-pwsh-tool-turn` expected output was that transcript, recorded and accepted, and the `terminal-bash` real-shell cases settled `inferred_idle` with an empty viewport where they expected `stdin_read` and `console=utf-8`.

Under a PTY the PowerShell host writes `ESC [ 6 n`, the CSI request for the cursor position, and blocks until the terminal answers `ESC [ row ; col R`. It asks at startup and again before every prompt, and PSReadLine asks too. The session emulates no terminal — it strips control sequences from a line stream — so no answer ever came, and the bootstrap line the session then wrote was consumed as the answer. From that point the host read nothing, which is why no command ran and why every readiness tier fell through to silence.

The startup wait masked it. `startupSession` accepted the controlled prompt anywhere in the rendered output, and the echoed bootstrap contains the prompt function's own source, `'arx> '` included, so the shell was declared ready on its own echo.

## Decision

The sanitizer counts cursor position requests in each chunk, and the session answers each one with a nominal `ESC [ 1 ; 1 R` through the same terminal write path a send uses. The report is nominal because nothing here models a screen; a host that asks only needs an answer to keep reading, and PSReadLine renders the input line relative to whatever it is told. A failed reply write is a transport failure, the same as a failed send write.

Startup readiness now requires the controlled prompt at the end of the rendered output — the viewport, or the retained scrollback when the prompt landed between sends — so an echo that merely contains the prompt text no longer counts. The bootstrap also sets `Set-PSReadLineOption -PredictionSource None -HistorySaveStyle SaveNothing`, guarded on the module being loaded: inline prediction rendered text from earlier sessions' history into the echo, and history saving wrote the model's commands into the user's history file.

The `persistent-pwsh-tool-turn` expected output is refreshed from a keyless replay and its tool result is `PWSH_OK`.

## Alternatives considered

- **Remove PSReadLine at startup.** The host's own line editor asks for the cursor position on every keystroke and redraws the whole line each time, so the echo grows quadratically with the command; with PSReadLine present the request comes once per prompt.
- **Set `TERM` to an xterm name for pwsh.** Changes nothing about the request — the host asks regardless — and adds keypad and color sequences to strip.
- **Track the cursor column and report it.** More faithful and no different in effect: the echo shape is the same for a nominal and a tracked column, and a tracked column is a screen model the session deliberately does not have.
- **Keep the printable-prompt startup check.** It is what let a wedged shell pass as ready and the failure transcript be recorded as expected output; the check has to distinguish a prompt from a mention of one.

## Consequences

Persistent pwsh runs on POSIX hosts; the two real-shell cases and the loader composition pass with a real pwsh 7.6, and the model sees only command output. The echo PSReadLine renders is still present and now also progressive — it re-renders the input line as bytes arrive, so the retained scrollback for one command holds several partial copies and its length varies with delivery timing; the marker-anchored extraction excludes it from results. Windows is unaffected: ConPTY answers the request itself, and the reply path is inert there.
