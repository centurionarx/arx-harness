/**
 * Web boot kernel. It owns only the module system, Cordis loader, and a
 * framework-free boot page. The dynamic UI renderer receives the mount
 * point after every client entry activates.
 * @module @arx-ai/arx-client-web/src/boot
 */
import type {} from '@arx-ai/arx-client-ui-auth/client'
import { Context } from '@arx-ai/cordis'
import Loader from '@arx-ai/cordis-plugin-loader'
import type {
  BootManifest, ClientModuleCreateOptions, ClientModuleSystem, ArxWindow,
} from '@arx-ai/arx-client-modules/client'
import type {} from '@arx-ai/arx-client-ui-renderer/client'
import type {} from '@arx-ai/arx-client-slots/client'
import type { ClientComposition } from '@arx-ai/arx-client-ui-slots'
import { BrowserAuthClient, type AuthBoundary, type AuthRevocationHandoff } from '@arx-ai/arx-client-ui-auth/browser'
import { assertCompositionManifest, parseBootManifest } from '@arx-ai/arx-client-modules/src/client/manifest.ts'
import { readClientAccessMode, verifiedComposition, type ClientAccessMode, type WebCompositionWindow } from './composition.ts'
import { BootPage } from './boot-page.ts'
import { getStaticModules } from './seed.ts'
import { STATE_LABELS } from './loader-status.ts'
import './base.css'

/** Module transport hook replaced by jsdom tests. */
export type BootSeams = Pick<ClientModuleCreateOptions, 'loadBundle'>

/** Browser boot entry consumed by `apps/web`. */
export class AppWebEntry {
  private readonly container: HTMLElement
  private readonly seams: BootSeams | undefined
  private readonly page: BootPage
  private ctx: Context | undefined
  private modules!: ClientModuleSystem
  private manifest!: BootManifest
  private auth: BrowserAuthClient | undefined
  private composition: ClientComposition | undefined
  private accessMode: ClientAccessMode = 'local'
  private epoch = 0
  private treeLifetime: AbortController | undefined
  private unmount: (() => void) | undefined
  private pendingRevocation: AuthRevocationHandoff | undefined
  private awaitingLogout = false
  private readonly onHide = (): void => { this.releaseRevocation() }
  private readonly onRestore = (event: PageTransitionEvent): void => {
    if (this.accessMode === 'authenticated' && event.persisted && !this.awaitingLogout) location.reload()
  }

  /**
   * Draw the boot page; {@link run} starts the loader.
   * @param container - Application mount point.
   * @param seams - Optional module transport replacement.
   */
  constructor(container: HTMLElement, seams?: BootSeams) {
    this.container = container
    this.seams = seams
    this.page = new BootPage(container)
    window.addEventListener('pageshow', this.onRestore)
    window.addEventListener('pagehide', this.onHide)
  }

  /**
   * Load and activate every client entry, then hand the mount point to the
   * UI renderer. Plugin failures remain visible on the boot page.
   * @returns Resolves after application mount or failure rendering.
   */
  async run(): Promise<void> {
    const epoch = ++this.epoch
    const admittedPath = location.pathname
    try {
      const win = globalThis as ArxWindow & WebCompositionWindow
      this.accessMode = readClientAccessMode(win)
      if (this.accessMode === 'authenticated') {
        if ((globalThis as { __ARX_TRANSPORT__?: unknown }).__ARX_TRANSPORT__ !== undefined
          || new URL(location.href).searchParams.has('fixture') || this.seams?.loadBundle !== undefined) {
          throw new Error('authenticated boot rejects client transport overrides')
        }
        this.treeLifetime = new AbortController()
        const { state, auth } = await BrowserAuthClient.bootstrap(
          (reason, confirmation) => { this.closeAuthTree(reason, confirmation) }, this.treeLifetime.signal)
        if (epoch !== this.epoch) { auth.dispose(); return }
        this.auth = auth
        if (location.pathname !== admittedPath) throw new Error('authenticated boot requires the admitted canonical pathname')
        this.composition = verifiedComposition(win.__ARX_CLIENT_COMPOSITION__, state, admittedPath)
        // The first native inline script stripped the fragment before any bundle;
        // AuthClient consumed its private one-use transfer before auth/session.
        assertCompositionManifest(parseBootManifest(win.__ARX_BOOT__), this.composition)
        const admission = auth.checkLogoutGuard(this.composition)
        if (admission !== 'admitted') {
          this.closeAuthTree('logout-blocked', undefined, admission === 'storage-unavailable')
          return
        }
      }
      const moduleLoader = win.__ModuleLoader__
      if (moduleLoader === undefined) {
        throw new Error('web boot: window.__ModuleLoader__ bootstrap facade is missing')
      }
      // A pre-injected transport (the worker preview page) owns bundle bytes;
      // its loadBundle is the default and explicit seams still win. The global
      // is `ClientTransportHooks`, owned by @arx-ai/arx-client-connection;
      // this structural slice reads one optional member without adding a
      // package edge.
      const transport = (globalThis as {
        __ARX_TRANSPORT__?: { loadBundle?: ClientModuleCreateOptions['loadBundle'] }
      }).__ARX_TRANSPORT__
      this.modules = moduleLoader.create({
        boot: win.__ARX_BOOT__,
        staticModules: getStaticModules(),
        ...(this.composition === undefined ? {} : { composition: this.composition }),
        ...(this.treeLifetime === undefined ? {} : { signal: this.treeLifetime.signal }),
        ...transport?.loadBundle === undefined ? {} : { loadBundle: transport.loadBundle },
        ...this.seams,
      })
      this.manifest = this.modules.manifest

      const prefetching = this.prefetchImmediateTier()
      const ctx = new Context()
      this.ctx = ctx
      if (this.composition !== undefined && this.auth !== undefined) {
        ctx.provide('clientComposition', this.composition)
        ctx.provide('webAuth', this.auth)
        const marker = Object.freeze({ kind: this.composition.kind, audience: this.composition.audience,
          ...(this.composition.generation === undefined ? {} : { generation: this.composition.generation }) })
        const manifest = this.manifest
        this.auth.start((fresh, pathname) => {
          if ((admittedPath !== '/reset' && admittedPath !== '/invite') || pathname !== admittedPath
            || location.pathname !== admittedPath) throw new Error('recovery requires the admitted canonical pathname')
          const recovered = verifiedComposition(marker, fresh, admittedPath)
          if (recovered.kind !== 'public' || recovered.scope !== 'application') throw new Error('recovery requires the public application tree')
          assertCompositionManifest(manifest, recovered)
        })
      }
      await this.runPluginBoot(ctx, prefetching, epoch)
      if (epoch !== this.epoch) return
      if (ctx.get('uiRenderer') === undefined) throw new Error('web boot: UI renderer did not provide its mount service')
      await this.mountApp(ctx)
    } catch (reason) {
      BrowserAuthClient.clearRecoveryTransfer()
      if (epoch !== this.epoch) return
      if (this.accessMode === 'authenticated') {
        this.closeAuthTree('unavailable')
      } else {
        console.error(reason)
        this.page.fail(reason instanceof Error ? reason.message : String(reason))
      }
    }
  }

  /** A principal boundary retracts protected DOM synchronously, before asynchronous disposal. */
  private closeAuthTree(reason: AuthBoundary, confirmation?: AuthRevocationHandoff, storageUnavailable = false): void {
    BrowserAuthClient.clearRecoveryTransfer()
    this.releaseRevocation()
    const epoch = ++this.epoch
    if (confirmation !== undefined) { this.pendingRevocation = confirmation; this.awaitingLogout = true }
    if (reason === 'logout-blocked') this.awaitingLogout = true
    this.treeLifetime?.abort(); this.treeLifetime = undefined
    this.unmount?.()
    this.unmount = undefined
    this.auth?.dispose()
    this.auth = undefined
    const ctx = this.ctx
    this.ctx = undefined
    this.container.replaceChildren()
    if (ctx !== undefined) void ctx.fiber.dispose().catch(() => {})
    // Detached snapshots must never reveal the previous principal via Back/BFCache.
    if (reason === 'pagehide') return
    const notice = document.createElement('div')
    notice.setAttribute('role', 'status')
    notice.setAttribute('data-arx-auth-boundary', reason)
    notice.textContent = confirmation !== undefined ? 'Encerrando sua sessão.'
      : reason === 'unavailable' ? 'Não foi possível validar sua sessão. Tente novamente.' : 'Sua sessão foi encerrada.'
    if (confirmation !== undefined) {
      if (!confirmation.persistent) notice.textContent = this.storageFailureNotice()
      this.container.appendChild(notice)
      void confirmation.confirmed.then((confirmed) => {
        if (this.pendingRevocation !== confirmation || epoch !== this.epoch) return
        this.pendingRevocation = undefined
        if (confirmed) {
          this.awaitingLogout = false
          if (reason === 'logout-pending') location.reload()
        } else {
          notice.textContent = confirmation.persistent
            ? 'Não foi possível confirmar a saída. O acesso permanece fechado.' : this.storageFailureNotice()
          this.offerExplicitLogin(notice)
        }
      })
      return
    }
    if (reason === 'logout-blocked') {
      notice.textContent = storageUnavailable ? this.storageFailureNotice() : 'A saída anterior não foi confirmada. O acesso permanece fechado.'
      this.offerExplicitLogin(notice)
      this.container.appendChild(notice)
      return
    }
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.textContent = 'Voltar ao acesso'
    retry.addEventListener('click', () => { location.reload() })
    notice.appendChild(retry)
    this.container.appendChild(notice)
    if (reason === 'revoked' || reason === 'restore') queueMicrotask(() => { location.reload() })
  }

  /** A new explicit login uses the existing public recovery entry and a fresh server-sealed boot. */
  private offerExplicitLogin(notice: HTMLElement): void {
    const login = document.createElement('button')
    login.type = 'button'
    login.textContent = 'Entrar novamente'
    login.addEventListener('click', () => { location.assign('/reset') })
    notice.appendChild(login)
  }

  /** No browser storage guarantee is claimed when this browser refuses the negative guard. */
  private storageFailureNotice(): string {
    return 'O acesso permanece fechado nesta página. O navegador não permitiu preservar o bloqueio após recarregar. '
      + 'Habilite o armazenamento para entrar novamente.'
  }

  /** Release only the document's neutral completion; its old auth tree is already absent. */
  private releaseRevocation(): void {
    this.pendingRevocation?.dispose()
    this.pendingRevocation = undefined
  }

  /** Dispose the client plugin tree and whichever page owns the mount point. */
  async dispose(): Promise<void> {
    BrowserAuthClient.clearRecoveryTransfer()
    this.epoch += 1
    this.treeLifetime?.abort(); this.treeLifetime = undefined
    window.removeEventListener('pageshow', this.onRestore)
    window.removeEventListener('pagehide', this.onHide)
    this.releaseRevocation()
    this.auth?.dispose()
    this.auth = undefined
    this.unmount?.()
    this.unmount = undefined
    const ctx = this.ctx
    this.ctx = undefined
    if (ctx !== undefined) await ctx.fiber.dispose()
    this.page.dispose()
  }

  /** Mount through a dependency fiber so replacing uiRenderer remounts the application. */
  private async mountApp(ctx: Context): Promise<void> {
    const mounted = ctx.inject(['uiRenderer'], (scope) => {
      scope.effect(() => {
        const unmount = scope.uiRenderer.mount(this.container)
        let live = true
        this.unmount = () => { if (live) { live = false; unmount() } }
        return this.unmount
      }, 'web boot: application mount')
    })
    await mounted
  }

  /** Prefetch stage-one bundles; their import path owns any eventual failure. */
  private async prefetchImmediateTier(): Promise<void> {
    // A transport carrying loadBundle owns the bundle bytes; HTTP prefetch
    // against its static deployment answers nothing. A transport without
    // loadBundle leaves bundles on HTTP, prefetch included.
    const transport = (globalThis as {
      __ARX_TRANSPORT__?: { loadBundle?: unknown }
    }).__ARX_TRANSPORT__
    if (transport?.loadBundle !== undefined) return
    await Promise.all(this.manifest.plugins
      .filter(row => row.immediately)
      .map(row => this.modules.prefetch(row.id).catch((_prefetchError: unknown) => {
        // Prefetch only starts transport early; the Loader import retries and reports this bundle failure.
      })))
  }

  /** Mount the Loader, create all graph entries, await quiescence, and audit activation. */
  private async runPluginBoot(ctx: Context, prefetching: Promise<void>, epoch: number): Promise<void> {
    if (epoch !== this.epoch) return
    await ctx.plugin(Loader)
    if (epoch !== this.epoch) return
    const loader = ctx.loader
    loader.internal = this.modules as never

    ctx.on('internal/status', (fiber) => {
      const entry = fiber.entry
      if (entry === undefined || entry.fiber === undefined) return
      this.page.setState(entry.options.name, STATE_LABELS[entry.fiber.state])
    })

    const rows = this.manifest.plugins.map(row => row.id)
    this.page.setTotal(rows.length)
    await prefetching
    if (epoch !== this.epoch) return
    await Promise.all(rows.map(async (name) => {
      if (epoch !== this.epoch) return
      this.page.setState(name, 'loading')
      const authConfig = this.accessMode === 'authenticated' && name === '@arx-ai/arx-client-connection'
        ? this.auth?.transportConfig() : undefined
      const id = await loader.create({ name, ...(authConfig === undefined ? {} : { config: authConfig }) })
      if (loader.resolve(id).fiber === undefined) this.page.setState(name, 'failed')
    }))

    await loader.await()
    if (epoch !== this.epoch) return
    this.assertEntriesActive(ctx)
  }

  /** Reject entries that failed import/apply or still wait on missing services. */
  private assertEntriesActive(ctx: Context): void {
    const failures: string[] = []
    for (const entry of ctx.loader.entries()) {
      const name = entry.options.name
      if (entry.fiber === undefined) {
        failures.push(`${name}: import failed (see console for the import error)`)
        continue
      }
      const state = STATE_LABELS[entry.fiber.state]
      if (state === 'active') continue
      if (state === 'pending') {
        const missing = Object.keys(entry.fiber.inject).filter(service => ctx.get(service) === undefined)
        failures.push(`${name}: pending (waiting for service${missing.length === 1 ? '' : 's'}: ${missing.join(', ') || 'unknown'})`)
      } else {
        failures.push(`${name}: ${state}`)
      }
    }
    if (failures.length > 0) {
      throw new Error(`web boot: ${String(failures.length)} entr${failures.length === 1 ? 'y' : 'ies'} did not activate\n${failures.join('\n')}`)
    }
  }
}
