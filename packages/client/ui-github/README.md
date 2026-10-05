# @arx-ai/arx-client-ui-github

The existing Configurações → GitHub page is a single `settings.section` contribution with id `github` and a localized label. It reads account state and owns PAT authorization independently of workspace availability. Repository browsing occupies the ui-repository-owned `repository.github` child slot and offers the `Configure GitHub` (`Configurar GitHub` in pt-BR) shortcut, which opens that settings page through `settings/open-section`. Both entries read one React-free controller's shared account facts; each registration waits for its actual slot declaration through `slots.inject`.

The repository entry store contains only the selected GitHub repository id, with no persistence. Workspace selection is owner data and its `selectWorkspace` callback retargets the same Git inspection panel. The parent Git control owns collapsed-panel expansion.

## Behavior

Account settings Refresh queries account state and the registered writable PAT method without fetching repositories. It retains previously loaded pages only when the refreshed connected account has the same concrete account id. Repository Refresh additionally queries the first repository page; Load more follows only the numeric server continuation. Not configured, disconnected and connected are distinct; authorization success alone never marks the account connected. Reconnect, credential metadata changes, account read failure and account changes clear repository facts. Refresh remains explicit, with no background account polling.

PAT authorization requires a writable account configuration and its registered writable `pat` method. Credential-reference mode cannot authorize. The native dialog makes the background inert, wraps only owned Tab edges and handles Escape without closing the containing settings panel. Closing the dialog returns focus to its source button. Draft answers exist only in local React state and are cleared on submit, cancel, prompt revision changes and page exit; no browser persistence or shared store retains them. The private attempt observable is supplied only to the account page. Leaving that page or removing its declaration revokes ownership, cancels its attempt and stops polling. An older mounting's cleanup or a late cancellation cannot clear a replacement page's attempt. Plugin disposal aborts and joins carrier work, including late-start cancellation. Credential invalidation closes the dialog and leaves account verification to an explicit Refresh.

The visible record-mode warning states that server-held credentials are not automatically model-visible but can be read by host tools running under the same UID. Operator credential storage and isolation choices are required before accepting a real PAT. External account and repository metadata is escaped plaintext, without external avatars, raw HTML or token references.

## Model Experience

### User-facing GitHub metadata and authorization

#### What the model sees

None. `remote.github.account` supplies read-only metadata to the GitHub account settings and repository views; `remote.github.repositories` supplies repository navigation. Generic authorization adds no automatic model input, tool, prompt or session event. Private human answers are not model context. Server-held credentials are not automatically model-visible, but this does not prevent same-UID host tools from reading credential storage; the dialog displays that warning before PAT submission.

#### Token effect

Zero direct model tokens. Account and repository metadata and transient authorization answers are not inserted into provider requests.

#### KV Cache effect

None. This package does not assemble or modify provider requests, so viewing and authorization changes do not alter a model-request prefix or its KV-cache reuse conditions.

## Known Limitations and Deferred Work

- Workspace + Repo choices establish only a view-only association for the current selection, not a durable binding. GitHub repository browsing is read-only; no create, clone or Git writes exist. PAT is supported, not OAuth. The parent sidebar.repository consumer owns local Git inspection and the workspace selection shared with this child. Host tools sharing the credential owner's UID are not isolated by this UI. The operator must configure the host provider; its default is unconfigured.
