# Agent Note: koffi 3.3.2 and 3.3.3 are excluded from the published ranges

Status: implemented

## Problem

koffi 3.3.2, published on 2026-09-27, does not compile from source with GCC 13: `src/koffi/src/uv.cc:91` gives `?:` a `Napi::Value` and a `nullptr`, which GCC rejects. koffi 3.3.3, published on 2026-10-10 at 05:37 UTC, still fails the same way at `src/koffi/src/uv.cc:88`; the upstream fix, [Koromix/rygel `5e7e1392`](https://github.com/Koromix/rygel/commit/5e7e1392) ("Fix Koffi build error with GCC"), landed at 14:35 UTC that day, after the release. koffi ships its binaries in per-platform optional dependencies, so an install that omits optional dependencies, or runs on a platform without a prebuilt package, builds it from source.

Six packages declare koffi: `arx-fs-local`, `arx-directory-picker-native`, `arx-sandbox-windows-acl`, `arx-session-persistence-jsonl`, `arx-subprocess-local`, and `arx-atomic-write`. The workspace lockfile resolves koffi 3.1.1, but `release:verify-packed-install` installs the packed tarballs with npm, `--omit=optional`, and no lockfile, so it resolves the newest release the ranges admit. It resolved 3.3.2, and after 3.3.3 was published it resolved 3.3.3, and failed both times. That step runs in every pull request's **Pack npm tarballs** job and in the manually dispatched publish workflow, which runs from an `arx-v*` tag, so every pull request turned red and a release could not publish. A consumer installing arx from npm without optional dependencies fails the same way.

## Decision

**The six ranges read `^3.1.0 <3.3.2 || ^3.3.4`.** They exclude exactly the two releases that do not build, keep every earlier 3.x release, and admit every later release without another change. On 2026-10-16 the upstream fix was on rygel's master branch but in no published koffi release. The lockfile changes only the six specifiers; the workspace still resolves 3.1.1.

## Alternatives considered

**Install optional dependencies in the packed-install check.** The check omits them because the Landlock platform packages need a musl toolchain per architecture, and a consumer that cannot install them must still start. Including them would hide a failure that such a consumer still meets.

**Cap the ranges below 3.3.2.** It also excludes every later release, including the first one to ship the upstream fix, so a fixed koffi would reach no consumer until the ranges change again.

**Pass npm `--before` with the workspace's release-age window.** The check would verify an older registry snapshot than a consumer installs today, so it would stop reporting a broken dependency release instead of preventing it.

## Consequences

- A consumer installing without optional dependencies builds koffi 3.3.1 or earlier from source, which GCC 13 accepts.
- A consumer installing with optional dependencies also resolves 3.3.1 and does not receive the 3.3.2 and 3.3.3 fixes; arx loads koffi only for fixed-arity Win32 calls, which those fixes do not affect.
- If koffi 3.3.4 still fails to build, the packed-install check fails again and the range needs another exclusion.
- The ranges carry an exclusion that a reader of `package.json` cannot explain without this note.
