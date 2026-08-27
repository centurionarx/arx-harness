# Agent Note: images through the vendor-CLI route

Status: implemented

English | [中文](2026-08-27-images-through-the-vendor-cli-route.zh.md)

## Problem

The vendor-CLI route refused every image block with `UNSUPPORTED_CONTENT`. That looked like a limit of the CLI, and it was not: it was a consequence of how this adapter opened a run.

When each step gained its own run, the transcript collapsed into one prompt *string*, and a string carries text. So the route that a subscription makes reachable — the one a user without an API key actually has — was the one route that could not read a screenshot.

## Decision

The SDK accepts `prompt` as an async iterable of user messages, not only a string. A run now opens with one structured user message whose content is the rendered transcript: labelled text for prior turns, and real image blocks where attachments sat.

Image bytes come from `ctx.attachments` through `readImageRequest`, the same store and the same normalization the HTTP adapters use. The vendor's documented pixel and byte limits are fixed constants rather than configuration: encoding past them produces a request the provider rejects, not a slower one.

Which models take images is configuration, per model, defaulting to false. The CLI discloses no catalog, so the route has to say; declaring it on a model that refuses images turns every attached image into a failed request instead of a refused attachment. A model that declares it reports `inputModalities: ['text', 'image']`, which is what the web BFF reads before it lets an image be attached at all.

## Consequences

Still one run per step, and still no live conversation — this changes what the opening message carries, not who closes a tool call. The deadlock that forced per-step runs is untouched.

A composition that mounts no attachment store serves text-only routes; an image reaching one fails naming the missing store rather than being silently dropped.

Documents that are not images — pdf, xlsx, docx, pptx — still have no representation. The attachment seam is image-shaped end to end (`ImageAttachmentRef`, `ImageMediaType`, the `image` content block), so carrying them is a separate change to that seam, not to this adapter.

## Alternatives considered

**Generalizing the attachment seam first.** Carrying documents means `ImageAttachmentRef` becoming `AttachmentRef` and every LLM adapter learning to refuse or carry a new block type. Images already had a complete path through the seam; only this adapter's own rendering blocked them, so widening the seam would have been a large change that fixed none of this.

**Extracting image text and sending it as prose.** It needs OCR the repository does not have, and it discards exactly what a user attaches a screenshot for.

**Keeping the string prompt and appending images as data URIs in text.** The model would read base64 as characters, spending context on bytes it cannot see.
