# Agent Note: Tool cards and frame chrome follow the session locale instead of Chinese

Status: implemented

## Problem

The owner's rule is that Chinese text inherited by the product is translated. The Web UI still showed Chinese in places a user reads or hears:

- **Tool cards.** `ReadBlock`, `DiffBlock`, `SearchBlock`, and `WebBlock` in `arx-client-ui-primitives` drew their copy buttons, expand and collapse toggles, the read window note, the search summary, and the empty and truncation notes as inline Chinese literals. They took no label props, so every locale saw them, and the assembled search-card golden recorded that summary.
- **Primitive defaults.** `TerminalBlock`, `CodeBlock`, `HoverCard`, `JsonBlock`, and `ConnectionBanner` took localized labels, but their defaults were Chinese, so a render site that passed none, such as a markdown code fence without `codeLabels`, showed the Chinese word for Copy.
- **Resize handles.** The two column separators in `arx-client-ui-layout` carried Chinese accessible names, which screen readers announce.
- **Dictionaries.** `arx-client-ui-schedule` and the experimental agent-team overlay declared a Chinese dictionary as the source of their key sets and registered only English.

## Decision

**Every tool card takes its copy as labels.** `ReadBlockLabels`, `DiffBlockLabels`, `SearchBlockLabels`, and `WebBlockLabels` follow `TerminalBlockLabels`: an optional, partial `labels` prop whose omitted fields fall back to English. A count reaches its label as a number, so the owner selects the grammatical number; the dictionaries interpolate without plural rules, so `searchBlockLabels` picks `search.match` or `search.matches` by count.

**`arx-client-ui-tool` builds the labels from the `conversation` namespace.** Each card model module exports its builder beside `terminalBlockLabels`, and both render sites, the chat row and the details panel, pass it. New keys cover the read window note, each card's collapse and expand names, the search summary nouns, and the web notes, in English and Portuguese. `card.expandRest` replaces `terminal.expandRest` as the "… N more lines" text all four capped cards share.

**Primitive defaults are English.** `TerminalBlock`, `CodeBlock`, `HoverCard`, `JsonBlock`, and `ConnectionBanner` default to the English copy of the dictionaries that normally supply them.

**The layout plugin owns a `layout` namespace.** AppFrame registers with `locale: 'layout'`, so the separators read "Resize sidebar" and "Resize details panel", or their Portuguese forms. The plugin now injects `locale` and declares `arx-client-locale` as a peer.

**English is the key source, and Portuguese joins.** `schedule.catalog` and `agentTeam` take their key sets from English, drop the Chinese dictionary, register `pt`, and leave the parity gate's `ENGLISH_ONLY` list.

**Comments quote rendered copy.** Comments and README passages that quoted Chinese copy now quote the English or Portuguese copy that renders.

## Alternatives considered

**English literals without label props.** Replacing the literals in place removes the Chinese, but a Portuguese session would read English card chrome inside a conversation whose other `conversation` copy is Portuguese since [the Portuguese Web UI](../feature/2026-09-27-web-ui-speaks-brazilian-portuguese.md). Label props let the cards follow the same namespace.

**Plural rules in the locale runtime.** They would move number agreement into the dictionaries, but no other namespace needs them yet, and the `Intl.PluralRules` categories differ by language, which makes them a runtime change of their own. Two keys per noun cover English and Portuguese.

**English literals for the separator names.** The names are announced, not drawn, but a Portuguese screen-reader user depends on them as much as on visible text, and a two-key namespace costs one registration.

**Translating internal CJK in the same change.** The connection fixture (`fixture.ts`), test data that exercises CJK rendering, and code that parses CJK input are not product copy: translating them changes test coverage or behavior, so they wait for a separate proposal.

## Consequences

- Under `pt`, the read, diff, search, web, and terminal cards, the resize handles, the Schedule catalog, and the agent-team overlay render Portuguese; under `en`, English.
- The `DiffBlock` footer (`└ +A -R · N file(s)`) stays English in both locales, the form the terminal transcript shares.
- Code that reads CJK input stays: the title counter in full-width parentheses, trailing CJK punctuation trimmed from labels, and the Chinese "recommended" suffix a model may write after an option.
- The keyless connection fixture still carries Chinese session and message text, which the assembled goldens built on it (`todo-row`, `search-card`) show.
- The search-card golden records the card in English and in Brazilian Portuguese.
