/** Real Cordis Loader over the same source faces; never a fake project context. */
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import * as slots from '@arx-ai/arx-client-slots/client'
import * as locale from '@arx-ai/arx-client-locale/client'
import * as theme from '@arx-ai/arx-client-ui-theme/client'
import * as renderer from '@arx-ai/arx-client-ui-renderer/client'
import * as authUi from '../src/client/index.ts'
import { NATIVE_RECOVERY_SCRIPT } from '../../modules/src/client/recovery-script.ts'
import { compositionPluginFace } from '../../modules/src/client/manifest.ts'
import { BrowserAuthClient, authComposition, type AuthBoundary } from '../src/browser.ts'
export async function applicationFixture(onBoundary: (reason: AuthBoundary) => void = () => {},
  beforeMount?: (ctx: Context, auth: BrowserAuthClient) => void | Promise<void>) {
  const ctx = new Context()
  let unmount: (() => void) | undefined
  const reloads: string[] = []
  // Execute the exact first-inline publisher before the real auth bootstrap.
  window.eval(NATIVE_RECOVERY_SCRIPT)
  const { state, auth } = await BrowserAuthClient.bootstrap((reason) => { unmount?.(); unmount = undefined; void ctx.fiber.dispose(); onBoundary(reason) }, undefined, () => { reloads.push('reload') })
  const composition = authComposition(state, location.pathname)
  if (composition.scope === 'project') throw new Error('source application fixture cannot mount a project')
  ctx.provide('clientComposition', composition); ctx.provide('webAuth', auth)
  const modules = new Map<string, unknown>([
    ['@arx-ai/arx-client-slots', slots], ['@arx-ai/arx-client-locale', locale],
    ['@arx-ai/arx-client-ui-theme', theme], ['@arx-ai/arx-client-ui-renderer', renderer],
    ['@arx-ai/arx-client-ui-auth', authUi],
  ])
  await ctx.plugin(Loader)
  ctx.loader.internal = { version: 'v2', async import(name: string) {
    if (!modules.has(name)) throw new Error('unexpected application Loader import')
    return compositionPluginFace(name, modules.get(name), composition)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  for (const name of modules.keys()) await ctx.loader.create({ name })
  await ctx.loader.await(); ctx.locale.setLocale('pt')
  await beforeMount?.(ctx, auth)
  const container = document.createElement('div'); document.body.appendChild(container)
  unmount = ctx.uiRenderer.mount(container)
  return { ctx, auth, container, reloads, composition,
    async close() { window.dispatchEvent(new Event('pagehide')); unmount?.(); unmount = undefined; auth.dispose(); await ctx.fiber.dispose(); container.remove() },
  }
}
