/**
 * Harness exit plugin, node half. The empty apply gives Loader a host-side row
 * while the browser half ships through `exports["./client"]`; the shutdown
 * itself is the launcher's, reached over `host.exit`.
 */

/** Host plugin body — this package contributes browser presentation only. */
export function apply(): void {}
