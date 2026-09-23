# @arx-ai/arx-host-open-in-app

The **host half of open-in-app**: it resolves a fixed catalog of editors, Git GUIs, terminals, and file managers to launchers this host actually holds, and serves the resolved list, each application's icon, and the launch itself to the Web session header's split button ([`arx-client-ui-open-in-app`](../../client/ui-open-in-app/README.md)). Only applications the host verified appear; an application installed while arx runs appears after a restart, and one removed since resolution leaves the list at its first failed launch.

## Use this package

Mount it in a composition that carries `connection`, `webServer`, and `subprocess`, beside its browser surface. The shipped Web profile ([`arx-web-app`](../../bundle/web-app/README.md)) mounts both as the `open-in-app` and `ui-open-in-app` rows.

```yaml
- name: '@arx-ai/arx-host-open-in-app'
  config:
    probeTimeoutMs: 10000
    iconTimeoutMs: 10000
    launchWatchMs: 1000
```

| Field | Default | Meaning |
|---|---|---|
| `probeTimeoutMs` | required | Per-command deadline in milliseconds for catalog-resolution host commands (`xcode-select`, the Windows registry reads). |
| `iconTimeoutMs` | required | Per-command deadline in milliseconds for icon-extraction host commands (`plutil`/`sips` on macOS, the PowerShell extraction on Windows). |
| `launchWatchMs` | required | Early-failure watch window per launch: a launcher still running when the window closes counts as launched and keeps running, so this bounds how long a launch request is held, not how long an application may live. |

The three deadlines are independent, so tuning one operation never changes another's response time; they are failure bounds, so conservative values cost nothing when commands are healthy. The generated [configuration catalog](../../../docs/config-catalog.md) is the exhaustive source for accepted fields. Choose `host.openPath` ([`arx-host-apiproxy`](../apiproxy/README.md)) instead to open one path with the operating system's default application; this package's subject is *which* application opens a workspace directory.

### The catalog

The catalog is a fixed list: editors and IDEs (Cursor, VS Code and Insiders, Windsurf, Zed, Sublime Text, Xcode, Android Studio, and the JetBrains IDEs IntelliJ IDEA, PyCharm, WebStorm, PhpStorm, GoLand, Rider, RustRover), Git GUIs (Fork, Sourcetree, GitHub Desktop, Tower, GitKraken, SmartGit, Sublime Merge), terminals and shells (Ghostty, Warp, iTerm2, kitty, Terminal, Windows Terminal, Windows PowerShell, PowerShell 7, Git Bash, GNOME Terminal, Konsole), and one file manager per platform (Finder, File Explorer, `xdg-open`). Each entry declares per-platform launcher sources tried in order, and every source yields a launcher the host holds, never a bare install record:

- **macOS** checks `/Applications` and `~/Applications` for the entry's bundle spellings and launches `open -a <bundle>`; Xcode follows `xcode-select -p`.
- **Windows** reads the `App Paths` registry keys, then the Uninstall records that prove an executable on disk, then known install paths and the newest versioned install directory, with one batched `reg.exe query` per root per pass. GitHub Desktop resolves its versioned executable together with its packaged `cli.js`.
- **Linux and Windows PATH names** resolve in-process through `ctx.subprocess.resolveExecutable()` (no shell, no `which`); Linux GUI entries whose command is off PATH fall back to their XDG desktop entry's verified `TryExec`/`Exec`, and `xdg-open` appears only when the host announces `DISPLAY` or `WAYLAND_DISPLAY`.

The Windows console shells open in the workspace directory without a path reaching a command line: **Windows PowerShell** (`${SystemRoot}\System32\WindowsPowerShell\v1.0\powershell.exe`, shipped with the OS) and **PowerShell 7** (`pwsh` on PATH) start with `-NoExit` and the directory as their working directory, so apostrophes and spaces in it need no quoting. **Git Bash** resolves from its Uninstall record, then `${ProgramFiles}\Git\git-bash.exe`, then the per-user installer's `${LOCALAPPDATA}\Programs\Git\git-bash.exe`, and receives the directory as one `--cd=<path>` argument. Every console launch is detached and visible.

### What to expect

When the inherited process environment carries a non-empty `SSH_CONNECTION` or `SSH_TTY` ([`launchedThroughSsh`](../../util/launch-environment/README.md)), the application list is empty before any probe and icons and launches are refused, so the Web header shows no button. A project or user `.env` naming either marker does not count.

Resolution runs lazily, once per host process, on the first request that needs it; a launch that finds its executable gone (`ENOENT`) re-resolves that one entry and drops it when nothing proves it anymore. Icons are the real application artwork where the host has one: the bundle's `.icns` as a 128px PNG on macOS, the executable's associated icon as a 32px PNG on Windows, and the desktop entry's hicolor-theme PNG or SVG on Linux. Each is extracted once per process and answered as a data URL; a missing icon answers null and the browser shows a generic glyph.

## Understand the implementation

[`src/catalog.ts`](src/catalog.ts) is the data table: each entry's per-platform locator chain (`fixed`, `app`, `xcode`, `cli`, `file`, `scan`, `app-paths`, `install-record`, `github-desktop`, `desktop`), its launch argv template (a `{path}` token carries the directory in place, otherwise it is appended, and `startsInPath` passes it as the working directory instead), and on Linux the desktop entry owning its icon. [`src/resolver.ts`](src/resolver.ts) resolves the table into a map of catalog id to verified launch, sharing one Windows registry read per pass. Argv launches spawn detached with the credential-scrubbed environment (`scrubbedParentEnv`) plus explicit adapter entries and keep Windows windows visible unless an adapter hides a CLI process that opens the GUI separately; file-manager entries hand the directory to the operating system's open verb through [`arx-native-command`](../../util/native-command/README.md)'s path opener. [`src/icons.ts`](src/icons.ts) and [`src/desktop-entry.ts`](src/desktop-entry.ts) extract icons per platform.

[`src/index.ts`](src/index.ts) registers one connection RPC channel, `/open-in-app`, with `authority: 'loopback'`: `apps` answers the map's keys, `icon` one entry's data URL, and `open` launches the map's verified launcher on the requested directory. The channel's route admits only a same-origin request to this machine's loopback address, the fence the gateway applies to `host.openPath` ([`arx-client-connection`](../../client/connection/README.md)), because a launch acts on the host desktop and the application list is reconnaissance. Each payload is validated in the plugin: a string `app` naming a catalog entry resolved on this host (`bad-request` for anything else, `open-unavailable` for an unresolved entry), and for `open` an absolute path (`workspace-invalid-path`) naming an existing directory (`directory-unreadable`); a launcher that fails answers `internal`. The endpoint names and payload types are published as the browser-safe `./shared` subpath, which the browser package inlines.

## Model Experience

None, as this package opens host applications for a person and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends a provider request.

## Known Limitations and Deferred Work

- **The catalog is fixed at build time.** A deployment cannot add its own editor or Git GUI from cordis.yml; extending the list means extending `OPEN_IN_APP_CATALOG` and the browser package's dictionary together. Configurable custom handlers are deferred until a settings owner and validation rules for arbitrary commands exist.
- **macOS detection is known-paths only.** A bundle renamed beyond the catalog's spellings or moved outside `/Applications` and `~/Applications` is not detected; there is no Launch Services query and deliberately no disk scan.
- **Icon fidelity is platform-bound.** Windows icons come from `ExtractAssociatedIcon` at 32px and can render soft on high-DPI displays; Linux icons follow the hicolor theme and pixmaps, not the active icon theme; CLI-only entries without a desktop record keep the generic glyph.
- **New installs appear after a restart.** Resolution runs once per host process; only the uninstall direction self-heals.
- **Loopback only.** A browser reaching the Web GUI through a trusted LAN host sees no button, because the channel refuses non-loopback requests; launching on the host desktop for a remote browser is not supported.
