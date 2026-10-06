# @arx-ai/arx-client-ui-repository

Read-only Git inspection for a registered workspace in the sidebar-owned sidebar.repository seat, independent of the session browser. The native workspace selector uses the framework workspace feed; selection and modal viewing state belong to the shared root entry store. A private React-free controller publishes identity, independent status groups and bounded unified patches through an inject observable.

## Behavior

A Settings composition occupies `settings.github.repository` and declares the optional `repository.github` child. It shares the same root StoreHandle as the local Git entry, supplies only the selected registered workspace id and a plain selection callback, and never receives account authorization data. Selection in either region updates the other; changing it while the Git declaration is absent starts no local Git read. Removing either declaration preserves selection while the other remains registered; releasing both clears that store instance. With no GitHub occupant, local Git behavior is unchanged. Collapsed mode renders only the Git rail control.

Selecting a workspace or remounting its selected entry reads repository identity and status. Refresh explicitly repeats the read. Prepared and Modified can both contain the same path; each opens its own comparison side. New opens the untracked comparison. Conflicts and submodules have disabled comparison controls. The native HTML dialog opens with showModal: the browser makes the background inert. A dialog-local unmodified Tab handler wraps only the first/last owned controls and directs initial content focus to a control; interior and Ctrl/Meta/Alt-modified navigation remain native. Opening focuses comparison content; Close or Escape cancels its read and restores the source file button, while collapsing or unmounting closes the dialog. Patch text, including newlines, is escaped React text, never HTML or tool-event content. Binary files show a notice. Remote failures remain retryable; non-repositories have their own state.

Workspace changes, modal closure, unmount, reconnect and disposal abort pending requests. Late replies cannot replace the new selection. Reconnect clears stale facts and requires an explicit refresh; there is no polling, watcher, Git write, authentication or clone operation. Slot declaration injection and locale effects follow plugin HMR lifetimes.

## Model Experience

### User-only repository inspection

#### What the model sees

Nothing from `sidebar.repository`: Git metadata and patches remain browser data and introduce no tools, prompts or session events.

#### Token effect

Zero direct token effect; patches are not added to model requests.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- Conflict and submodule comparisons require explicit host support. GitHub account binding is a separate authenticated capability; sanitized remote identities do not imply a connected account. Repository inspection requires the host read-only provider and a workspace containing the supported repository.
