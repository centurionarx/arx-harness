# Project workspace UI

The `@arx-ai/arx-client-ui-projects` plugin adds Projects to the sidebar. It consumes the generated `projects` Remote through `api-remotes`, and mounts only after the sidebar declares its footer-action slot.

## Behavior

Choose an existing workspace and create a project. Plans retain immutable revisions: editing tasks preserves their stable ids, removing a task removes references to that id, and new tasks receive new ids. Each save includes the aggregate version read by this view. Concurrent edits reject the stale write and preserve the draft; Refresh explicitly reloads the project. Approval names the displayed exact plan revision and is an operator action.

The prompt library creates immutable template revisions, edits typed variable declarations, and preserves source skill snapshots. Existing prompt identities retain their names. Plan history remains visible. Task evidence links to the recorded execution session. Workflow runs expose their persisted states, attempts, limits, and deadline without claiming that an interrupted external action was resumed.

## Composition

The web bundle includes the project service, project tool, generated Remote contribution, and this UI. Removing the UI row removes only the view. Durable data remains owned by the project service and storage-domain.

## Validation

Component tests cover stable task ids, dependencies, exact-revision approval, stale-write recovery, delayed reads, and workspace selection. Browser tests use the real Remote and JSON storage path.

## Model Experience

None, as this browser plugin edits operator-owned project data and registers no model prompt, schema, or result.

#### KV Cache effect

The view changes no request prefix; the project tool and saved-step driver own later model-visible use.

## Known Limitations and Deferred Work

- Reads refresh on opening, selecting, or explicit Refresh; CAS rejects stale writes. Source skill selection, task progress, and workflow definitions are supplied through the project tool or trusted API. Budget and reconciliation buttons release eligible work for the original parent session to execute through the project tool; they do not launch an unattended background run. Usage is reported when measured, with unknown calls labeled.
