# Repository inspection

## Run

Requires the built checkout, Git and a browser. Start this overlay only when you want a separate instance; it does not update an already-running GUI:

```sh
pnpm arx --profile web --patch examples/repository-inspection/cordis.yml
```

Open the printed loopback URL, register an existing local directory through Add workspace, then select it explicitly in Repository. Prepared and Modified rows for the same file open independent, escaped read-only comparisons. Native dialogs make background controls inert; Escape returns focus to their source buttons. Local Git inspection requires no model key and exposes no staging, commit, push or clone operations. Open Settings → GitHub to inspect account configuration without registering or selecting a workspace. Account authorization lives in that page; the repository child opens it through Configure GitHub. GitHub defaults to Not configured with PAT acceptance disabled; credential storage requires an explicit operator choice. Other Web-profile features retain their normal permissions.

## Keyless evidence

After the official build, run the focused browser scenarios without rebuilding shared artifacts:

```sh
ARX_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/repository-inspection.e2e.ts
```

Use `ARX_SNAPSHOT=refresh` with the same command to regenerate the product-user transcripts. The [scenario](../../apps/web/tests/repository-inspection.e2e.ts) loads the runnable [overlay](cordis.yml) through the existing Loader scaffold, boots real Node services and generated HTTP/WebSocket Remote transport, then drives the built renderer in Chromium. No model request occurs. The scaffold owns its random-port server and temporary registry, settings, credentials, sessions and Git directories and awaits disposal; cleanup assertions verify the temporary roots are removed.

The [default transcript](repository.expected.md) covers the single GitHub settings entry before any workspace exists, default Not configured with no PAT acceptance or external requests, explicit registered-workspace selection and independent Prepared/Modified patches. The fixture fixes its branch, author and commit dates rather than normalizing Git states. Existing fixture normalization substitutes only transient workspace paths and IDs. DOM patch strings are compared directly with real Git output, including trailing newlines; markup remains escaped. Strict Tab/Shift+Tab containment, native modal inertness and Escape source focus are acceptance assertions. All Git-owned file hashes and write timestamps, raw index bytes and worktree contents remain unchanged. Unsupported filters remain backend unit coverage.

### Synthetic GitHub account

The [test-only credential overlay](github-record.overlay.yml) enables record mode only inside the scaffold-owned temporary harness home. Do not apply it to a personal profile or store. The [external fixture](github-fetch-fixture.ts) intercepts only native Node fetch requests to fixed GitHub account/repository GET endpoints, checks the synthetic bearer header and delegates all other fetches to their native implementation. No actual GitHub account, PAT or user-network request is used.

The [configured transcript](github.expected.md) covers account configuration without a selected workspace, a synthetic answer through the real private generic authorization dialog, empty draft after cancellation and section remount, native Escape closing only that dialog, verified account metadata without repository requests, escaped repository metadata, two bounded pages and a private repository. GitHub workspace selection retargets the existing Git owner between two registered real Git directories and clears the prior pairing; the resulting patch is checked against actual Git. The synthetic answer and abandoned drafts are excluded from browser persistence, transcripts, session events/logs and public HTTP/WebSocket DTOs; its only browser outbound occurrence must be the private `authorization.submit` request. A synthetic 401 remains Disconnected without deleting the stored record. Both repositories retain their Git/index bytes.

These scenarios cover Chromium on the executing host, not a full browser suite or a cross-platform run.
