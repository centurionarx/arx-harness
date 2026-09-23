/**
 * ModelDirectoryResolver (`ctx.modelDirectories`): the root owner of per-session
 * {@link ModelDirectory} instances. Both selection entries (the /model popup
 * and the composer model seat) resolve their session's directory through
 * this service, which is what makes the dual entry one shared state.
 *
 * Per-session storage follows the client service pattern (InputTriggerService /
 * CommandUiRuntime): a lazy service-internal map whose entry is deleted by the
 * owning scope's disposer. The host `arx-scope` ScopedLayers registry does
 * does not belong here: it derives scope from the host carrier mechanism
 * (object-keyed), while client scopes tag contexts with branded SessionId
 * strings, and it models global+shadow named registries — this is a
 * per-session singleton with no global layer to merge.
 */
import { Service } from '@arx-ai/cordis'
import type { Context } from '@arx-ai/cordis'
import type { ConnectionHandle, SessionId } from '@arx-ai/arx-api-remotes/client'
import type { SessionRuntime } from '@arx-ai/arx-client-runtime/client'
import type { ComposerBlock } from '@arx-ai/arx-client-ui-conversation/client'
// Type-only: pulls the `settings/open-section` event declaration.
import type {} from '@arx-ai/arx-client-ui-settings/client'
import { ModelDirectory } from './directory.ts'
import type { ModelDirectoryState } from './directory.ts'

declare module '@arx-ai/cordis' {
  interface Context {
    modelDirectories: ModelDirectoryResolver
  }
}

/**
 * The settings section that adds a provider: the Models page's id. The shell
 * opens its first section when no entry registers this one.
 */
const PROVIDER_SECTION = 'models'

/** The composer-block copy this plugin owns, read at raise time. */
export interface ComposerBlockCopy {
  /** A selection names a route no adapter serves. */
  unavailable: () => string
  /** Nothing is selected yet, and some provider can serve a selection. */
  unselected: () => string
  /** No provider serves anything, so there is nothing to select. */
  noProvider: () => string
  /** Accessible name of the composer while it opens the provider settings. */
  setUpProvider: () => string
}

/**
 * The block one directory answer raises. Only a definite `routable: false`
 * blocks, and its reason says what the user can do about it. With no provider
 * at all there is nothing to select, so that block carries the way to add one.
 * @param state - the session's directory snapshot.
 * @param copy - this plugin's block copy.
 * @param openProviders - open the settings section that adds a provider.
 * @returns the block to raise, or undefined to clear it.
 */
function composerBlockFor(
  state: ModelDirectoryState,
  copy: ComposerBlockCopy,
  openProviders: () => void,
): ComposerBlock | undefined {
  if (state.routable !== false) return undefined
  if (state.groups.length === 0 && state.failures.length === 0) {
    return { reason: copy.noProvider(), action: { label: copy.setUpProvider(), run: openProviders } }
  }
  return { reason: state.current === null ? copy.unselected() : copy.unavailable() }
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Per-session directories; entries are deleted by their scope disposer. */
  readonly directories: Map<SessionId, ModelDirectory>
}

/** The `ctx.modelDirectories` session model-selection service. */
export class ModelDirectoryResolver extends Service {
  static inject = ['connection', 'sessions', 'remote']

  private readonly live: LiveState = { directories: new Map() }

  /** Localized composer-block copy; this plugin owns the strings it raises. */
  private readonly blockCopy: ComposerBlockCopy

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   * @param config - the block copy, bound to this plugin's own dictionary.
   */
  constructor(ctx: Context, config: { blockCopy: ComposerBlockCopy }) {
    super(ctx, 'modelDirectories')
    this.blockCopy = config.blockCopy
    ctx.on('connection/reset', () => {
      for (const directory of this.live.directories.values()) directory.resetConnected()
    })
    // Either source can change the directory: registry topology commits and
    // settings documents that carry provider catalogs or default selection.
    const refresh = (): void => {
      for (const directory of this.live.directories.values()) {
        directory.load().catch(() => undefined)
      }
    }
    ctx.remote.$on('llm/adapters-updated', refresh)
    ctx.remote.$on('settings/document-updated', refresh)
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const existing = live.directories.get(sessionId)
    if (existing !== undefined) return existing
    const sessions = this.ctx.get('sessions') as SessionRuntime
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
    const connection = this.ctx.get('connection') as ConnectionHandle
    const directory = new ModelDirectory(
      connection.api.sessions,
      sessionId,
      () => sessions.subagentAddress(sessionId) === undefined,
    )
    live.directories.set(sessionId, directory)
    // The composer cannot read this plugin (the dependency runs one way), so
    // the block is pushed: the Host says whether an adapter serves the
    // session's route, and only a definite `false` makes the input inert.
    // `null` — before the first load, or after one failed — must not, or a
    // slow or unreachable Host would lock a working composer.
    const conversation = this.ctx.get('conversation')
    if (conversation !== undefined) {
      const openProviders = (): void => { this.ctx.emit('settings/open-section', PROVIDER_SECTION) }
      const publish = (): void => {
        conversation.blocks.set(sessionId, composerBlockFor(directory.store.getSnapshot(), this.blockCopy, openProviders))
      }
      publish()
      actx.effect(() => {
        const stop = directory.store.subscribe(publish)
        return () => {
          stop()
          conversation.blocks.set(sessionId, undefined)
        }
      }, 'ui-model-selection: composer block')
    }
    actx.effect(() => () => {
      directory.dispose()
      live.directories.delete(sessionId)
    }, 'ui-model-selection: session directory')
    return directory
  }
}
