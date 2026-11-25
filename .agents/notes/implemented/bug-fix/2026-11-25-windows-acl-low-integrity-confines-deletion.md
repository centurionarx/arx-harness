# Agent Note: The Windows ACL sandbox runs the child at Low integrity so deletion stays inside the granted roots

Status: implemented

## Problem

The win32 rung's `WRITE_RESTRICTED` token evaluates the restricting SIDs only for write access, and Microsoft does not define which access rights count. The native runner matrix (`packages/sandbox/sandbox-windows-acl/tests/runner.spec.ts`, case "outside the granted roots") showed on Windows Server 2025 that DELETE and FILE_DELETE_CHILD pass on the user's normal access, while WRITE_DAC, WRITE_OWNER, FILE_WRITE_DATA, and WRITE_DAC or VM-write opens on the runner process are denied. A confined child in either mode could therefore delete any file or empty directory its user may delete, and under `workspace-write` could move an external file into the workspace. It could not create, write, rename in place, or re-ACL anything outside the granted roots.

## Decision

Both modes lower the restricted token to Low mandatory integrity: `setTokenIntegrityLow` calls `SetTokenInformation(TokenIntegrityLevel)` with S-1-16-4096 after `CreateRestrictedToken` and before the default-DACL merge, and a failure fails `init` closed. The [MS-DTYP mandatory integrity check](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-dtyp/ae69a089-473d-4c23-bf3d-7a12a9d11123) gives a subject that does not dominate an object's label only read and execute access, which excludes DELETE, FILE_DELETE_CHILD, WRITE_DAC, and WRITE_OWNER on every object at Medium or above; an unlabeled file carries an implicit Medium label.

`grantWrite` applies the capability ACE and an inheritable Low label (OI|CI, NO_WRITE_UP) in one `SetNamedSecurityInfoW(DACL | LABEL)` call, so each grant walks the tree once. The exact-grant skip requires both the ACE and the label, so a root granted before the label existed takes one re-apply. `revokeWrite` changes the DACL only: private temp directories are removed after revocation, and workspace labels stand like workspace ACEs. The restricting-SID lists, the grant mask, and the runner argv are unchanged.

## Alternatives considered

- **Explicit deny ACEs, such as FILE_DELETE_CHILD inherited by folders.** For this token only the normal access check evaluates DELETE and FILE_DELETE_CHILD, and its SIDs are the same as those of the user's unconfined processes. A deny ACE would either block the user's own tools or miss the confined child, and denying FILE_DELETE_CHILD alone leaves the DELETE-on-file path open.
- **A fully restricted token or a deny-only user SID.** Both remove arbitrary reads, which is the harness's read model.
- **Untrusted integrity.** PowerShell does not start at that level.
- **AppContainer, mxc, or a dedicated user account.** The [original rung decision](../feature/2026-08-08-windows-acl-restricted-token-sandbox.md) rejects them for arbitrary reads and the OS floor.
- **Relabeling roots back to Medium when a session ends.** This would close cross-root deletion between sessions that do not overlap, at the cost of two full-tree propagations per session, which defeats the standing-grant reuse cache. It stays available if the residual below is judged unacceptable.
- **A distinct integrity level per workspace.** Integrity levels form a linear order, so a higher level dominates every lower one and cannot partition workspaces.

## Consequences

Deleting, moving away, or re-ACLing an object at the implicit Medium label is denied in both modes unless its parent directory is Low-labeled, because FILE_DELETE_CHILD on a Low parent deletes any child. Medium process objects refuse write access to the confined child. The Everyone boundary narrows to Low-labeled objects. Every Low-labeled object outside the current roots stays deletable through the user's normal access, for example every root ever granted on the machine, live private temp directories, files hard-linked into a granted root, packaged-app data under `%LOCALAPPDATA%\Packages`, `%USERPROFILE%\AppData\LocalLow`, and `HKCU\Software\AppDataLow`.

Granting now needs WRITE_OWNER on the root in addition to ownership, because setting a label requires it; an access-denied grant names that right in its error. Whether SMB or non-NTFS roots accept the label is unverified. Labels are standing, so any Low-integrity process of the same user passes the mandatory check on a granted workspace and is limited only by the DACL; `icacls <dir> /setintegritylevel (OI)(CI)M` restores the Medium level until the next grant of that root. Propagation also relabels every file hard-linked into a granted root, which the hard-link runner test pins: a pnpm store file linked into a workspace becomes deletable by any confined child and writable by any Low-integrity process the DACL admits, across every project that links it. Low integrity blocks writes to named pipes and objects created by Medium processes. A file moved into the workspace keeps its Medium label, so the confined child cannot modify it but can delete or replace it through its Low parent, and a grant does not relabel it while the root's ACE and label stand. Running `pnpm install`, credential helpers, or ssh-agent inside the sandbox is unverified.

The native matrix also records a behavior this decision does not change, which stays a known limitation: under `workspace-write`, confined PowerShell cannot start `cmd.exe` or `icacls.exe` with captured output (`Program '…' failed to run: Access is denied`), before and after the Low-integrity change, while the same script under `read-only` starts both. Its cause is not established. Before the change, `Remove-Item -Force` was the only deletion API denied in both modes; after it, every deletion probe is denied.

## Testing

The runner suite's outside-the-roots matrix requires every probe to be denied and every victim to keep its content in both modes. The Everyone-Modify test pins Medium-labeled directories as denied and a Low-labeled one as writable, and a NUL test pins `cmd > NUL` and writes to the NUL device path as working in both modes. A propagation test writes a file that existed before the first grant, and relabels a root whose standing ACE lacked the Low label. `acl.spec.ts` reads the Low label back on the root and on an existing child, and confirms `revokeWrite` leaves it. The stub suites (`acl-failure-paths`, `token-failure-paths`, `index-failure-paths`) cover the label skip and re-apply branches, the `TOKEN_MANDATORY_LABEL` buffer, and the order and fail-closed path in `init`. The hosted CI runner is an elevated administrator on Windows Server 2025, so standard-user Medium tokens and Windows 10 and 11 are not covered.

## Related

The [Windows ACL rung decision](../feature/2026-08-08-windows-acl-restricted-token-sandbox.md) owns the token and grant design this note extends.
