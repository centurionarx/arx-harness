# @arx-ai/arx-client-ui-turn-outline

English | [Português](README.pt-BR.md)

Optional `conversation.view` contribution showing the [whole-session turn index](../../session/session-turn-outline/README.md). The Turn outline tab displays the first user-text preview and recorded outcome for every turn, including older turns whose conversation rows are not loaded. Search queries the complete host index through authenticated Remote pages. Each response and rendered list contains at most 100 turns; Older turns replaces the page and Newest turns returns to the latest matching page. An unavailable projection is shown explicitly; the UI does not reconstruct a partial index from the loaded window.

Selecting a turn asks the conversation owner to reveal its exact starting sequence. The owner loads at most 20 history pages serially, stops on a failed or non-progressing page, and activates Chat only after resolving a visible row within that turn. Chat applies and clears a one-shot row target, preserving the resulting position across tab switches. Leaving the outline or switching sessions invalidates pending navigation; an already dispatched history request may finish. A refused navigation displays a retryable explanation. Turns with no visible chat row cannot be opened.

This plugin owns no business store, host event, filesystem access, or model-visible input. It uses the existing view slot, standard projection hook, and localized copy registry.

## Model Experience

None, as the plugin only pages and renders the replay-derived turn index.

#### KV Cache effect

None; this package does not change model requests or their token prefixes.

## Known Limitations and Deferred Work

- Navigation may require several attempts in a history more than 20 pages away. The host retains the complete replay-derived index; the browser keeps one bounded page. The turn outcome is the recorded loop reason and does not evaluate whether the requested work was correct.
