/** Independent read-only repository client contribution. */
import type { ClientContext } from '@arx-ai/arx-client-runtime/client'
import type {} from '@arx-ai/arx-api-remotes/client'
import type {} from '@arx-ai/arx-client-locale/client'
import type {} from '@arx-ai/arx-client-ui-sidebar/client'
import type { RemoteResult } from '@arx-ai/arx-typert-protocol'
import { RepositoryController } from './controller.ts'
import { RepositoryEntry } from './RepositoryEntry.tsx'
import { createRepositoryViewStore } from './store.ts'
import type { RepositoryInjected } from './props.ts'
import { en, pt, type RepositoryKey } from './locales.ts'
export { createRepositoryViewStore } from './store.ts'
export type { GithubInspectionOwnerProps, RepositoryProps, RepositoryInjected } from './props.ts'
declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only repository copy. */
    repository: RepositoryKey
  }
}
/** Service presence scopes the read port to the active generated Remote provider. */
export const inject = ['slots', 'locale', 'remote', 'remote.repository']
/** Register only after the sidebar declares the repository seat.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('repository', { en, pt }), 'ui-repository: dictionaries')
  const unwrap = async <T>(pending: Promise<RemoteResult<T>>): Promise<T> => {
    const result = await pending
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  ctx.slots.inject('sidebar.repository', () => {
    const controller = new RepositoryController({
      inspect: (request, signal) => unwrap(ctx.remote.repository.inspect(request, signal)),
      status: (request, signal) => unwrap(ctx.remote.repository.status(request, signal)),
      diff: (request, signal) => unwrap(ctx.remote.repository.diff(request, signal)),
    })
    const reset = ctx.on('connection/reset', () => { controller.invalidate() })
    const injected: RepositoryInjected = {
      hooks: { repository: controller }, select: (id) => { controller.select(id) },
      refresh: () => controller.refresh(), show: request => controller.show(request),
      close: () => { controller.close() }, cancel: () => { controller.cancel() },
    }
    const unregister = ctx.slots.register({
      name: 'sidebar.repository', locale: 'repository', store: createRepositoryViewStore(), inject: () => injected,
      children: { 'repository.github': { kind: 'single', scope: 'root' } },
    }, RepositoryEntry)
    // oxlint-disable-next-line typescript/no-misused-promises -- slots.inject installs this disposer through Cordis ctx.effect.
    return async () => {
      unregister()
      reset()
      await controller.dispose()
    }
  })
}
