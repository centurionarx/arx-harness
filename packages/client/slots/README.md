# Client slots

This neutral Cordis provider owns the existing SlotRegistry and framework snapshot-store engine. Project runtime keeps compatibility reexports. Both application and project components register through the same slots.register API and derive props from the shared SlotMap; application roots do not require sessions, workspaces, or a connection.

Native boot disables browser persistence for these stores and clears arx view caches when a principal's tree ends. Cleanup preserves only the neutral `arx.web.logout-denial` guard; the auth owner removes it after a matching logout acknowledgement or fresh server-validated admission. The composition flag is a readonly tree view, never authorization. Project remains the default for existing local deployments.

The architecture and pending integrated acceptance are recorded in the [application composition proposal](../../../.agents/notes/proposed/architecture/2026-10-08-native-application-slots-and-boot-lifetime.md).

## Model Experience

### Browser composition and snapshot stores

#### What the model sees

Nothing from this package. `SlotRegistry` registers browser presentation components and the framework store engine exposes view snapshots; neither registers a prompt, tool definition, model-visible schema, or session message.

#### Token effect

Zero additional model-input tokens. Snapshot or slot registration changes do not assemble or mutate a provider request.

#### KV Cache effect

None. This package changes no provider-request prefix, schema order, or model context.

## Known Limitations and Deferred Work

- Application props omit project hooks at compile time, but tree composition is not a backend authorization boundary. Native HTTP, RPC, event, and worker admission remain responsible for access checks.
- Browser view persistence is disabled in authenticated trees. Durable owner content belongs to the server storage provider; session resume and fork require genuine project services.
- Complete installed-bundle, browser, and operational isolation acceptance for the native graph remains pending in the linked proposal.
