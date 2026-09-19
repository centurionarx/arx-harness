# Agent Note: Preview current session files beside Chat

Status: implemented

## Problem

File references previously opened only through the system handler. A preview beside Chat needs current content without bypassing the owning Agent filesystem or exposing active document content to the application.

## Decision

The optional [file preview Remote](../../../../packages/fs/file-preview/README.md) resolves each request through the live Agent's scoped filesystem and session cwd. It applies extension allowlisting, regular-file validation, workspace containment, a provider-enforced byte bound, and descriptor identity verification in the local provider before encoding JSON-safe text or base64. It uses the existing authenticated Remote transport and adds no public file-serving route.

The optional [preview contribution](../../../../packages/client/ui-file-preview/README.md) occupies a new Details chain declared by the conversation owner. The owner continues to route original session-relative file references and owns the explicit native-open callback. Preview state uses the existing conversation viewing store; the contribution owns only transient request and Blob-resource state.

## Security and lifecycle

The host rejects SVG, final symlinks, escaping paths, inaccessible or detached sessions, unsupported extensions, invalid text, and oversized reads. Cordis traces services with fresh wrappers, so provider continuity compares the canonical service identity while all filesystem calls keep the Agent-traced wrapper. A scoped-provider regression test proves that a readable root filesystem cannot bypass an Agent provider's refusal.

Markdown images can be disabled through an additive primitive prop whose default preserves current Chat rendering. HTML is stripped of active elements and URL attributes, reconstructed behind a restrictive CSP, and rendered in an opaque sandbox. Raster-image URLs are revoked on replacement and unmount. PDF.js 6.3.289 renders at most 10 passive page canvases, each bounded to 2,000,000 pixels and a 4,096-pixel edge, with annotations and XFA disabled. It owns a bundled module worker and cancels rendering, destroys the document and worker, clears canvases, and revokes the worker URL on replacement or unmount. Changed owners discard stale responses; native opening is explicit.

## Consequences

Focused tests cover real Loader composition, scoped-provider refusal, bounded reads, owner cancellation, JSON wire results, plugin registration/disposal, unsafe HTML and Markdown, escaped code, binary URL cleanup, refresh, and stale response disposal. Preview operations leave session events unchanged. Tests also cover descriptor identity changes before size reporting, paged PDF rendering limits, cancellation, and worker disposal. The explicit native action remains available for documents the preview cannot render. Current bytes are not a historical artifact snapshot. This packet is an ARX implementation on its existing Remote and slot contracts; no upstream preview source was copied.

## Alternatives considered

Public file URLs would create a new authorization surface. Reading directly from the host would bypass scoped filesystem providers. HTML without an opaque sandbox would expose active content to the application. A sandboxed native PDF iframe failed in a real Chrome check, so PDF uses bounded canvas rendering instead. The implementation keeps content behind authenticated Remote reads and renders each allowed format in an isolated viewing surface.
