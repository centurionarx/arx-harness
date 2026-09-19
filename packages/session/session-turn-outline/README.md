# @arx-ai/arx-session-turn-outline

English | [Português](README.pt-BR.md)

Optional whole-session turn index served through the session projection registry. It folds the complete durable log into the `turnOutline` projection, including inherited fork history. Each entry retains the turn number, exact `turn/start` sequence, optional ending sequence, first direct user-text preview, and recorded ending reason. Open turns report `running`.

The preview normalizes whitespace and retains at most 120 Unicode code points. Later user steering and plugin-authored messages do not replace the first nonempty preview. Text-free turns remain addressable with an empty preview. The index retains one entry per turn in immutable chunks of at most 256 entries. Each update copies only the newest chunk and shares older chunks, so replay does not copy the complete index per event. It has no truncation or configuration; its storage grows with turn count. Compacting model context or paging browser history does not discard the source log or index.

The registry owns replay, optional cache persistence, schema validation, and client delivery. Wire updates contain at most 100 recent turns plus the total count and an older-page cursor. The authenticated `turnOutlines.page(sessionId, before, query)` Remote searches the complete host index and returns at most 100 matches; search text is limited to 200 characters. Unloading this plugin removes its projection key. The [outline UI](../../client/ui-turn-outline/README.md) supplies search and navigation.

## Model Experience

None, as the projection only derives viewing data from existing session events.

#### KV Cache effect

None; this package does not change model requests or their token prefixes.

## Known Limitations and Deferred Work

- The preview is an excerpt of user input, not a model-generated summary or proof of successful task execution. The ending reason records the loop outcome. The complete host index and optional checkpoint grow with turn count; browser updates remain bounded.
