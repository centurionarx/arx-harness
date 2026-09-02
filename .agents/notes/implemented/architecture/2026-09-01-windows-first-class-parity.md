# Agent Note: Windows first-class parity — gate, publish smoke, Git Bash, and runtime exe

Status: implemented

## Problem

Windows was documented as first-class, but four real gaps kept it from behaving like one. (1) No gate held the base bundle's complementary win32 rungs (bash rows off / pwsh rows on), so an incomplete platform override could silently compose a family a host cannot execute. (2) The README quickstart's `npx @arx-ai/arx` depends on an npm channel that had never shipped a power-packed install on Windows, and the native lane's blocking set (`ci-windows-blocking`) contained only build plus site. (3) POSIX-authored skills and hooks broke on the pwsh default because bash had no Windows runner (`bat-local` resolved nothing there), and the only pre-commit job that could not run on Windows was `scripts/check-vendor-manifest.sh`. (4) The Python SDK runtime exe build treated Windows as a documented non-goal (2026-07-10 single-exe note).

## Decision

- **Phase 0 gate** — `pnpm run verify:windows-parity` (tsx, run on any host, blocking in `ciSharedStaticGates` and `ciWindowsBlockingGates`): proves the base patch's complementary win32 rungs per row id; rejects `.sh` references in lefthook jobs and in the Windows-lane gate-construction functions of `run-gates.ts` (read structurally, because importing the runner demands a pnpm environment); and fails any product `SKILL.md` whose fenced bash/sh blocks carry POSIX-only syntax (`bash script.sh`, `sh script.sh`, `bash -c`, `sed -i`) without a pwsh/powershell variant anywhere in the file.
- **Phase 1 publish smoke** — `ci-windows-blocking` now packs every tarball family (`release:pack --family arx/vendor`, the Landlock entry) and drives `release:verify-packed-install --family arx` after the build, proving the packed-install shape natively on windows-2025 before anything publishes. The real `npm publish` stays in the release lanes (registry credentials live there, not in PR CI).
- **Phase 3.1 bash on Windows** — `arx-bash-local` gains `bashPath` config plus `resolve.ts` (the pwsh seam's resolution twin): explicit path first, then well-known Git for Windows locations, then `PATH` `bash.exe` entries with the WSL `C:\Windows\System32` stub excluded; a probing miss fails activation loudly naming the search. `run()`/`start()`/`bash-sandbox`'s `confine()` all build argv through one `shellArgv()` accessor, so the sandbox's confined inner shell matches the executor's runtime. The base rows stay disabled on win32 — pwsh remains the default; the bash-restore recipe is now viable on Git-Bash-equipped hosts.
- **Phase 3.2 pre-commit port** — `scripts/check-vendor-manifest.ts` replaces the bash guard verbatim in behavior; `lefthook.yml` runs it through tsx and the cookbook's pointer is updated.
- **Phase 3.3 runtime exe** — `@yao-pkg` target `node24-win-x64` (pkg-canonical `win`, not `windows`); products carry the spawnable `.exe` and the ripgrep twin ships as `-rg.exe` because `CreateProcess` appends `​.exe` and never finds an extensionless PE. `search-core` names the sidecar through one `rgSidecarSuffix()`, `platforms.json`/`hatch_build.py`/`build-python-release.py` carry the `py3-none-win_amd64` wheel pair, and the workflow's matrix builds the target on `windows-2025` with bash-rendered steps and a `Scripts/python.exe` venv fallback.

## Consequences

- The npm-404 quickstart gap is now caught per-PR on Windows by the blocking packed-install smoke, and publishing is a credential-only step in the existing release lanes.
- POSIX-authored hooks and skills work on Windows exactly when the bash-restore recipe is applied and Git Bash exists; the detector plus the pwsh-variant rule keep the default pwsh composition documented as the first-class path.
- The `2026-07-10-single-file-executable-sdk-runtime-distribution` note's Windows non-goal is superseded by this one; its wheel-tag list (three tags) is extended by `py3-none-win_amd64` here.
- The Windows native-lane unit exclusions (executor fixtures hardcode POSIX cwd such as `/tmp`) are unchanged; exercising them under Git Bash is a follow-up, tracked here as the known limitation of this change.

## Alternatives considered

- **Promoting Linux snapshot lanes onto Windows.** Rejected: the repo's CI policy gives Linux the required snapshots and Windows the observational duplicates; a duplicate snapshot lane would burn runner minutes without pinning new behavior.
- **WSL bash support.** Rejected for default resolution: WSL's `System32` stub silently changes the mount and credential model; it remains reachable through an explicit `bashPath`.
- **Auto-enabling the bash family on Git-Bash-present hosts.** Rejected: a default composition flipping per host state violates the fail-loud composition contract; the recipe plus the gate keeps the choice explicit.
