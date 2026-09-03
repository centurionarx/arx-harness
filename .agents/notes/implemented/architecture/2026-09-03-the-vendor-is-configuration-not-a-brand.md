# Agent Note: the vendor is configuration, not a brand

Status: implemented

## Problem

The model vendor's name ran through the product as a brand: comments, JSDoc, Markdown, test titles, identifiers, file names, CSS custom properties, and one first-run dialog. The same string also spells working configuration — route ids, model ids, endpoints, credential environment variables, and one protocol dialect value — where changing a character breaks a live integration and no test in this repository would catch it.

## Decision

The name goes wherever it names the vendor; it stays byte-identical wherever it configures reaching the vendor. The keep list is `deepseek-official` and the `deepseek` catalog route key, the `deepseek-v4-*` / `deepseek-chat` / `deepseek-reasoner` model ids, `DEEPSEEK_API_KEY` and `DEEPSEEK_BASE_URL`, `api.deepseek.com`, `thinkingFormat: deepseek`, and provider display names. Everything else names the mechanism or drops the clause. The name is never rewritten to `arx` or `Centurionarx`: the product is not the vendor.

The design-token ramp `--arx-static-deepseek-*` became `--arx-static-azure-*`. `deepsuite`, the visual-baseline codename, is a different word and stays.

## Consequences

Two packages that carried the name in their own names are gone, and their referents went with them. `python/sdk-runtime` mounted `@arx-ai/arx-llm-deepseek` and so had no adapter at all; it now mounts `@arx-ai/arx-llm-pi-ai` with the `deepseek-official` route declared, matching the runnable examples. `web-search-deepseek` left the browser's web-search card bound to a namespace no plugin owns; the card renders nothing and is retired with the seam work in the companion note.

The first-run credential dialog was deleted rather than renamed. Its premise was gone either way: it offered one vendor's route to a user with no usable provider, which is the shipped-default posture the no-shipped-default-model decision retired, and it read only that route's credential. `settings.onboarding` keeps its modal and its versioned notice; what left is the vendor-specific credential step. `apps/web/tests/onboarding-usable-provider.e2e.ts` still drives it and cannot pass — that file is one of twenty-four in a web e2e lane already broken by the single-locale change, and the lane needs its own pass.

`DeepSeekModelsEditor.tsx` was not a deletion: its shared helpers became `model-catalog.ts`, consumed by `CustomProviderCard`.

## Alternatives considered

**Renaming the first-run dialog and keeping it.** A name-removal change is licensed to rename, not to retire a surface, and this one retired it silently. Keeping it would have restored a dialog that pushes one vendor in a product that had just decided to ship pointed at none — so the deletion stands and is recorded here instead of being left implicit.

**Rewriting the name to the product's.** That inverts the meaning: it makes arx look like the model vendor in every sentence that explained which vendor a route reaches.
