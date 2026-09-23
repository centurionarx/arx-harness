# Agent Note: the blank-session hero leads with the product brand

Status: implemented

## Problem

The blank-session hero carried copy inherited from the upstream snapshot: a 34 px mark, the localized headline `Into the Unknown`, and a `Preview` badge. The product name appeared only in the sidebar brand row, at a 48 px mark and a 24 px wordmark. The owner asked for the new-session screen to show the arx HARNESS brand instead, at twice the sidebar's size, without the badge, and for it to disappear when the first message is sent by Enter or the send arrow.

## Decision

[`arx-client-ui-conversation`](../../../../packages/client/ui-conversation/README.md) declares a second root-scoped single slot, `conversation.hero.brand.name`, beside the existing `conversation.hero.brand.mark`. `HeroShell` renders the mark at a 96 px edge and the name at 48 px height, twice the sidebar row, and drops the `hero.headline` and `hero.preview` locale keys. Without an occupant the name slot falls back to the `ARX Local Build` text the sidebar shows in the same place, so unbranded builds never display the official name.

[`arx-client-ui-brand-official`](../../../../packages/client/ui-brand-official/README.md) fills the new slot with the official wordmark inside its existing declaration-aware registration set, which now has four occupants and still installs only under `ARX_CLIENT_BUILD_PROFILE=official`.

Disappearance needs no new state. `ConversationRoot` renders `HeroShell` only in the hero phase, and the first send flips the phase for Enter and the send button alike; typing does not flip it. The headline carries `data-hero-headline`, which gives browser tests a locator independent of build profile and locale.

## Alternatives considered

- **Change the headline text to `arx HARNESS`.** Rejected: the name would become a translatable string outside the build-profile gate, so unbranded builds would show the official name, and it would render as text instead of the official artwork.
- **Let the `conversation.hero.brand.mark` occupant draw mark and name together.** Rejected: that slot's `size` is a square edge, and one occupant for both artworks would break the independent mark/name pairing the sidebar already uses.
- **Hide the headline as soon as the user types.** Rejected by the owner: the brand stays while a draft is edited and leaves with the first send.

## Consequences

- The official headline is decorative artwork: the wordmark SVG is `aria-hidden`, as in the sidebar, so the accessibility tree of an official build shows no headline text, and the product name reaches assistive technology through the document title. The `lifecycle-chrome` goldens lose the `Into the Unknown Preview` line.
- Deployment packages can replace the hero name independently of the mark by occupying `conversation.hero.brand.name`; the slot appears in the generated client slot catalog.
- The hero headline no longer depends on locale data, so a translation cannot rename the product.
