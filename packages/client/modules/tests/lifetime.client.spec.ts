// @vitest-environment jsdom
/** Kernel lifetime and neutral faces over one actual ClientModuleSystem. */
import { afterEach, describe, expect, it } from 'vitest'
import { ClientModuleSystem } from '../src/client/system.ts'
import { parseBootManifest, type ClientBundleRegistration, type ClientModuleLoaderTarget } from '../src/client/manifest.ts'

const MODULES = '@arx-ai/arx-client-modules'
const LOCALE = '@arx-ai/arx-client-locale'
function system(signal?: AbortSignal, composition?: { kind: 'public' | 'user'; audience: 'user'; scope: 'application' | 'project' },
  bundle?: (target: ClientModuleLoaderTarget) => Promise<void>) {
  const target: ClientModuleLoaderTarget = {
    mode: 'queue', pendingQueue: [], load() { throw new Error('not installed') },
    create() { throw new Error('use the actual system constructor') },
  }
  const loader = new ClientModuleSystem({
    manifest: parseBootManifest({ rev: 'fixture', entries: [{ id: LOCALE, url: '/plugins/locale/client.js', rev: 'fixture' }] }),
    staticModules: {}, registrationTarget: target, bootstrapModule: { id: MODULES, exports: {} },
    ...(signal === undefined ? {} : { signal }), ...(composition === undefined ? {} : { composition }),
    ...(bundle === undefined ? {} : { loadBundle: () => bundle(target) }),
  })
  return { loader, target }
}
afterEach(() => { document.head.replaceChildren() })
describe('client module tree lifetime', () => {
  it('cancels an actual pending script and rejects later imports', async () => {
    const lifetime = new AbortController(), { loader } = system(lifetime.signal)
    const pending = loader.import(LOCALE)
    const outcome = expect(pending).rejects.toThrow('client module tree ended')
    expect(document.querySelector('script')?.getAttribute('src')).toBe('/plugins/locale/client.js')
    lifetime.abort()
    await outcome
    expect(document.querySelector('script')).toBeNull()
    expect(loader.loadCache.has(LOCALE)).toBe(false)
    await expect(loader.import(LOCALE)).rejects.toThrow('client module tree ended')
  })
  it('rejects a late bundle registration before executing its factory', async () => {
    const lifetime = new AbortController()
    let release!: () => void, ran = 0
    const { loader } = system(lifetime.signal, undefined, async (target) => {
      await new Promise<void>((resolve) => { release = resolve })
      target.load({ id: LOCALE, factory: () => { ran++; return {} } })
    })
    const pending = loader.import(LOCALE)
    const outcome = expect(pending).rejects.toThrow('client module tree ended')
    lifetime.abort(); release()
    await outcome
    expect(ran).toBe(0); expect(loader.loadCache.has(LOCALE)).toBe(false)
  })
  it('selects a neutral face from one factory cache and requires a fresh project boot', async () => {
    let ran = 0
    const apply = () => {}, application = { inject: ['slots'], apply }
    const exports = { inject: ['slots', 'connection', 'remote', 'settingsScope'], apply, application, presentation: {} }
    const registration: ClientBundleRegistration = { id: LOCALE, factory: () => { ran++; return exports } }
    const neutral = system(undefined, { kind: 'public', audience: 'user', scope: 'application' }, async (target) => { target.load(registration) })
    expect(await neutral.loader.import(LOCALE)).toBe(application)
    expect(await neutral.loader.import(LOCALE + '/client')).toBe(application)
    expect(neutral.loader.loadCache.get(LOCALE)?.exports).toBe(exports)
    expect(ran).toBe(1)
    const project = system(undefined, { kind: 'user', audience: 'user', scope: 'project' }, async (target) => { target.load(registration) })
    expect(await project.loader.import(LOCALE)).toBe(exports)
    expect(ran).toBe(2); expect(project.loader.loadCache).not.toBe(neutral.loader.loadCache)
  })
})
