# Agent Note: Identity files require private access on Windows too

Status: implemented

## Problem

Seven startup checks of the AUTH packages rejected an identity file that other accounts can reach only on POSIX. Each check ended in `process.platform !== 'win32' && (<mode bits> || <owner>)`, so on Windows no access rule applied to the private identity key (`web-identity-sqlite` `readPrivateKey`), the Resend key file, the identity database and its directory, or the authority journal's root directory, `authority.jsonl` and `watermark.json`. [The coverage-gate note](../testing/2026-11-19-coverage-gate-builds-library-faces.md) recorded the gap. The native Windows CI lane also reported the POSIX operands of those seven conditions as uncovered branches, which kept `windows node 24 / native complete` red on every pull request.

## Decision

[`privateAccessViolation(path, info, { posixOwner })`](../../../../packages/util/atomic-write/src/private-access.ts) in `@arx-ai/arx-atomic-write` decides, for an existing entry the caller has already typed with `lstat`, whether a principal other than the process user can reach it. It returns the first violation as text, or `undefined`.

- **POSIX** keeps the predicate the seven checks had: a group or other mode bit rejects, and with `posixOwner: true` an owner other than `process.getuid()` rejects. The key files and the journal pass `posixOwner: true`; the identity database and its directory pass `false`, as their inline checks did.
- **Windows** reads the owner and DACL with `GetFileSecurityW` and parses the self-relative descriptor from a Node `Buffer`. The trusted principals are the process user, SYSTEM (`S-1-5-18`) and Administrators (`S-1-5-32-544`), which already control every local file. The owner must be one of them, the DACL must be present and non-null, every access-allowed entry must name one of them whatever its mask or inheritance flags, and any entry type other than access-allowed or access-denied rejects. Deny entries are ignored. A malformed descriptor is a violation, and a failed native read rejects the promise.
- Each of the seven call sites tests the entry type first, then the access. Its `identityFailure` code and message are unchanged. The violation travels as the error's `cause` through the new optional `detail` argument of `identityFailure`, so an operator reads the path, the SID and the access mask, and an HTTP response never carries them.

`atomic-write` owns the check because it already creates private Windows files with a protected current-user DACL, resolves the process user's SID, and loads Koffi only on the Windows path.

[private-access.spec.ts](../../../../packages/util/atomic-write/tests/private-access.spec.ts) drives the descriptor parser with crafted buffers on every platform and compares, on POSIX, the shared predicate with the seven former inline expressions over 17 modes, two owners, five entry kinds and both owner policies. [win32-native.spec.ts](../../../../packages/util/atomic-write/tests/win32-native.spec.ts) reads real descriptors on the Windows runner: a temporary directory, a plain file, a directory and an atomic private file pass, an `icacls` grant to Everyone and an inherit-only grant to Users reject, and a deny entry for Everyone passes. Each identity spec keeps its POSIX block unchanged and adds a Windows branch that grants Everyone read with `icacls` and expects the same rejection, with a cause naming `S-1-1-0`.

## Alternatives considered

**Read the ACL in `@arx-ai/arx-sandbox-windows-acl`.** That package uses the same native mechanism, but it is the sandbox backend and imports Koffi at module load, so every POSIX identity server would load it.

**Reject only allow entries that carry read, write, delete, `WRITE_DAC` or `WRITE_OWNER`.** A mask table must map generic and specific rights and still lets an entry grant other rights to another account. An identity file with any allow entry for another account is not private.

**Create the directories with a protected DACL under `allowInitialize`.** The check verifies and never changes a permission. Creating private Windows directories is deferred; a `TODO` marks both `mkdir` sites.

**Keep the inline conditions and stub `process.platform` in four packages' specs.** It would cover the POSIX operands on Windows while the product still applied no Windows rule.

## Consequences

- A Windows deployment whose identity files inherit an allow entry for another account, such as Users, Authenticated Users or CREATOR OWNER from a custom parent, fails at startup. The cause names the entry to remove.
- Placeholder SIDs such as CREATOR OWNER and OWNER RIGHTS reject like any other principal.
- On POSIX the identity database and its directory still do not compare their owner with the process user. The key files and the journal do.
- On Windows `allowInitialize` creates the identity and authority directories with mode 0700, which sets no ACL. A new directory passes only when the entries it inherits are already private.
- The authority journal publishes its watermark on Windows with a plain `rename` and no retry, unlike `publishWin32`. A short sharing violation from a scanner or indexer makes the append fail and leaves the journal unavailable until restart. This is outside this change.
- Volumes without persistent ACLs report a descriptor that grants Everyone access, so identity files cannot live on them under Windows.
- The window between `lstat`, the access read and the later open is the one the POSIX mode check already had.
