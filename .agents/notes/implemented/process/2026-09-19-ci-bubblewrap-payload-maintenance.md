# Agent Note: Maintain the pinned CI bubblewrap payload

Status: implemented

English | [Português](2026-09-19-ci-bubblewrap-payload-maintenance.pt-BR.md)

## Problem

Ubuntu removes superseded binary packages from its active archive. A missing pinned bubblewrap payload stops CI provisioning before coverage or application snapshots can run; retrying a permanent HTTP 404 cannot restore those checks.

## Decision

The [CI preparation script](../../../../scripts/prepare-ci-bubblewrap.sh) pins Ubuntu Noble bubblewrap `0.9.0-1ubuntu0.3` and its SHA256. Package refreshes verify the archive's `InRelease` signature with the Ubuntu archive keyring, the signed checksum of `Packages.xz`, and the package checksum recorded in that index against the downloaded bytes. Extraction remains confined to the ephemeral runner directory. The checksum check and functional namespace probe remain mandatory.

Development-machine validation checks the payload without changing host security policy. A probe denied by the machine's existing AppArmor policy is recorded as a validation limit; the hosted CI runner remains responsible for its existing user-namespace setup and complete functional probe.

## Alternatives considered

**Retry the removed version.** Repeated requests to an unavailable payload leave the same provisioning failure.

**Resolve an unpinned package during CI.** This changes the executed sandbox binary without a reviewable version and checksum. A package-manager transaction also adds the hosted image's package-maintenance overhead.

## Consequences

The checks retain a reproducible sandbox payload and fail closed on unavailable or mismatched downloads. Future archive removals require another verified pin refresh; this maintenance does not disable confinement checks or relax coverage requirements.
