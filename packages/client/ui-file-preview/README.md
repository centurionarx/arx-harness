# @arx-ai/arx-client-ui-file-preview

Optional document preview beside Chat, using the conversation owner's `details.content` chain and the [authenticated file preview service](../../fs/file-preview/README.md). Existing file references and deliverables open in Details when this plugin is installed. The conversation owner keeps the original session-relative path; native opening remains an explicit button using its existing workspace handler.

Markdown uses the existing escaped Markdown renderer with automatic remote images disabled. Code renders as escaped text. HTML is reconstructed with active elements and URL-bearing attributes removed, a restrictive CSP, and an opaque iframe sandbox without scripts or same-origin privileges. SVG is refused by the host. Raster images use bounded Blob URLs that are revoked when replaced or unmounted. PDFs render as passive canvases using [PDF.js](https://mozilla.github.io/pdf.js/examples/) 6.3.289 and an owned module worker. The first 10 pages render with at most 2,000,000 pixels and a 4,096-pixel edge per page; annotations and XFA are disabled. Worker resources, rendering tasks, canvases, and object URLs are released on replacement and unmount.

The panel labels contents as current, can refresh them, and reports inaccessible or unsupported files without silently opening another application. Changed paths, sessions, or unmounted panels discard stale responses. No model content or durable artifact version is created.

## Integration

The optional capability marks supported file-open requests for Details. The host service remains authoritative for extension allowlisting, workspace containment, and byte limits. A deployment without this client plugin retains the existing native file handler; a deployment with it must mount `@arx-ai/arx-file-preview` and expose its generated Remote through the existing gateway.

PDF.js and its bundled worker are distributed under [Apache License 2.0](https://github.com/mozilla/pdf.js/blob/master/LICENSE); the pinned npm dependency preserves its upstream license notices.

## Model Experience

None, as the plugin only renders current file previews and adds no model-visible input.

#### KV Cache effect

None; this package does not change model requests or their token prefixes.

## Known Limitations and Deferred Work

- Text previews require UTF-8. HTML intentionally omits scripts, forms, embedded documents, navigation URLs, and external media. PDF previews show at most the first 10 pages and omit annotations, forms, and interactive actions. Unsupported fonts or malformed documents may produce a passive error; the explicit system-application action remains available. The panel displays current file contents, not a saved revision of a historical deliverable.
