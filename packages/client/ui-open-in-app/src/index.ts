/**
 * Open-in-app browser surface, node half. Pure UI plugin: the empty apply
 * keeps the plugin on the host roster and in the Loader; the browser half
 * ships via exports["./client"], discovered through the package.json
 * arx.client declaration. The channel it calls lives in
 * `@arx-ai/arx-host-open-in-app`.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
