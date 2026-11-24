/**
 * Test helper that orders a step after the isolated project runtime registers a downlink.
 * @module arx-isolated-project-runtime/tests/downlinks
 */

/**
 * Resolves when the runtime registers its next downlink. A quiescence or a session expiry ends only registered
 * downlinks, and a host event reaches only a registered downlink, so a test waits for the registration instead
 * of for elapsed time.
 * @param runtime - The isolated project runtime that opens the downlink.
 * @returns A promise settled by the next registration.
 */
export function downlinkRegistered(runtime: unknown): Promise<undefined> {
  const downlinks = (runtime as { downlinks: Set<unknown> }).downlinks
  const registered = Promise.withResolvers<undefined>(), add = downlinks.add.bind(downlinks)
  downlinks.add = (value: unknown) => {
    delete (downlinks as Partial<Set<unknown>>).add
    registered.resolve(undefined)
    return add(value)
  }
  return registered.promise
}
