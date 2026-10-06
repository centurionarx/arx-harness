/** Settings account and repository navigation share one GitHub metadata controller. */
import type { ClientContext } from '@arx-ai/arx-client-runtime/client'
import type { ConnectionHandle } from '@arx-ai/arx-api-remotes/client'
import type {} from '@arx-ai/arx-client-locale/client'
import type {} from '@arx-ai/arx-client-ui-repository/client'
import type {} from '@arx-ai/arx-client-ui-settings/client'
import type { RemoteResult } from '@arx-ai/arx-typert-protocol'
import { GithubController } from './controller.ts'
import { GithubEntry } from './GithubEntry.tsx'
import { GithubAccountSection } from './GithubAccountSection.tsx'
import { createGithubViewStore } from './store.ts'
import type { GithubAccountInjected, GithubInjected } from './props.ts'
import { en, pt, type GithubKey } from './locales.ts'
export { createGithubViewStore } from './store.ts'
export type { GithubAccountInjected, GithubAccountProps, GithubInjected, GithubProps } from './props.ts'
declare module '@arx-ai/arx-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** User-facing GitHub account and repository copy. */
    github: GithubKey
  }
}
/** Generated GitHub Remote and the generic authorization carrier are independent capabilities. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.github']
/** Contribute account settings and repository browsing within the Settings page.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('github', { en, pt }), 'ui-github: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const unwrap = async <T>(pending: Promise<RemoteResult<T>>): Promise<T> => {
    const result = await pending
    if (!result.ok) throw new Error('GitHub metadata request failed')
    return result.value
  }
  const controller = new GithubController({
    account: (request, signal) => unwrap(ctx.remote.github.account(request, signal)),
    repositories: (request, signal) => unwrap(ctx.remote.github.repositories(request, signal)),
  }, connection.api.authorization)
  ctx.effect(() => () => controller.dispose(), 'ui-github: controller lifetime')
  ctx.effect(() => {
    const disposers = [
      ctx.on('connection/reset', () => { controller.invalidate() }),
      ctx.remote.$on('credentials/reference-updated', () => { controller.invalidate() }),
      ctx.remote.$on('credentials/record-updated', () => { controller.invalidate() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-github: metadata invalidation')
  const accountFace: GithubAccountInjected = {
    hooks: { github: controller, authorization: controller.authorizationView },
    refresh: () => controller.refreshAccount(),
    begin: () => controller.begin(), submit: answer => controller.submit(answer), cancel: () => controller.cancel(),
    watch: () => controller.watch(),
  }
  const repositoryFace: GithubInjected = {
    hooks: { github: controller }, refresh: () => controller.refresh(), more: () => controller.more(),
  }
  ctx.slots.inject('settings.section', () => {
    const unregister = ctx.slots.register({
      name: 'settings.section', id: 'github', order: 12, locale: 'github',
      label: () => ctx.locale.bind('github')('title'), inject: () => accountFace,
      children: { 'settings.github.repository': { kind: 'single', scope: 'root' } },
    }, GithubAccountSection)
    // oxlint-disable-next-line typescript/no-misused-promises -- Cordis awaits the declaration-bound effect disposer.
    return async () => { unregister(); await controller.leave() }
  })
  ctx.slots.inject('repository.github', () => ctx.slots.register({
    name: 'repository.github', locale: 'github', store: createGithubViewStore(), inject: () => repositoryFace,
  }, GithubEntry))
}
