# @arx-ai/arx-client-ui-schedule

Read-only Schedule catalog for the active conversation. The browser plugin contributes one action to `conversation.session.header.actions` and reads the optional `schedule` Session projection supplied by `@arx-ai/arx-schedule`. It renders nothing when the projection is absent, the Session is not open, or no reminders are active, so compositions without Schedule keep the existing header unchanged.

The catalog shows reminder text, one-time or exact fixed-rate frequency, local absolute time, and a relative scheduled or overdue state. It deliberately exposes no ids, raw timestamps, mutation controls, or host error details. Its copy comes from the `schedule.catalog` dictionaries in English and Brazilian Portuguese. The popover is portaled to the document body, closes on Escape or an outside pointer press, and restores trigger focus after keyboard dismissal.

Relative time advances once per second only while the catalog is open. Closing or unmounting the catalog clears that interval. Reminder storage and delivery remain process-local responsibilities of `@arx-ai/arx-schedule`; this package neither polls the Host nor claims external notification delivery while a Session is cold.

## Model Experience

None, as this package reads an existing wire projection and adds no prompt, message, tool schema, or provider request.

#### KV Cache effect

The catalog never assembles model input.

## Known Limitations and Deferred Work

- The list is read-only. Creation and deletion remain model-tool operations.
- Absolute times use the browser's current locale and time zone; the durable record remains UTC.
- A process restart can reconstruct the projection from the Session log, but a reminder still runs on time only while its owning Session is live.
