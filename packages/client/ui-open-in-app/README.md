# @arx-ai/arx-client-ui-open-in-app

Web **open-in-app** surface: contributes one entry to `conversation.session.header.utilities`, a split button that opens the session's workspace directory in an application installed on the host — an editor, a Git GUI, a terminal or shell (Windows PowerShell, PowerShell 7, and Git Bash on Windows), or the file manager. The list, the icons, and the launch come from the loopback-only `/open-in-app` connection RPC channel of [`arx-host-open-in-app`](../../host/open-in-app/README.md), whose endpoint names and payload types this package inlines from the host package's `./shared` subpath.

The main half opens the default application, named in its tooltip ("Open in VS Code"); the chevron lists every application with the default marked "(default)". The default is the application last picked from the list, persisted in the browser under `arx.open-in-app.choice` and shared by every session header, or the host's first application when the remembered one is no longer offered. A launch from the main half never changes that choice; a successful pick from the list does. While a launch is in flight both halves are disabled, and a failed launch announces "Could not open. Try again." from the button's own toast.

The entry renders nothing until it has something to open: no workspace directory, an empty list, or a page that is not on loopback (the channel refuses those requests, so the controller does not ask). It lists only catalog ids its dictionary names, so a host catalog extension without copy stays hidden instead of showing a raw id. The application list and each icon are read once per page; icons arrive as data URLs after the list and fall back to a generic glyph when absent or broken. Copy lives in the package's own `open-in-app` locale namespace.

## Model Experience

None, as this package opens host applications for a person and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **The list is read once per page** — an application the host re-resolves after a failed launch leaves the list on the next page load; until then the stale entry answers the launch failure toast.
- **No file-level actions** — the button opens the workspace directory only; opening one file in a chosen application from a preview or a produced-file row is not ported.
