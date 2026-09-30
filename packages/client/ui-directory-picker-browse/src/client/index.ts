/**
 * Browser half of the browse directory-picker backend: fills ui-workspace's
 * two directory-flow holes with the in-app Select Workspace Directory dialog
 * (figma `Harness` 813-23126 family), driving the node half's
 * `host.listDirectory`/`host.createDirectory` primitives. Mounting this
 * package therefore composes both sides of the browse interaction with one
 * cordis.yml row; no client code branches on a capability kind. The dialog's
 * copy is locale-registered here — the flow package owns its own strings.
 */
import type { ClientContext } from '@arx-ai/arx-client-runtime/client'
// Type-only: pulls the SlotMap merge declaring the directory-flow holes.
import type {} from '@arx-ai/arx-client-ui-workspace/client'
import type { BrowseFlowInjected } from './flow.ts'
import { BrowseDirectoryFlow } from './flow.ts'

/** Locale namespace owning the browser dialog's copy. */
const LOCALE_NS = 'directory-browser'

/** Required services (cordis fiber inject): the slot registry, the wire-facing workspace service, and locale. */
export const inject = ['slots', 'workspaces', 'locale']

/**
 * Client plugin body: register the dialog's dictionary and the browse flow
 * into both directory-flow holes through `slots.inject()` because the
 * ui-workspace entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // Each `register` call throws having stored nothing when a rival already
  // owns that locale of the namespace. A failed Portuguese registration
  // removes the English one before rethrowing, so a failed activation squats
  // no locale.
  ctx.effect(() => {
    const disposeEn = ctx.locale.register(LOCALE_NS, 'en', {
      'browser.title': 'Select Workspace Directory',
      'browser.home': 'Home',
      'browser.newFolder': 'New folder',
      'browser.folderName': 'Folder name',
      'browser.createIn': 'New folder in "{name}"',
      'browser.untitledFolder': 'Untitled folder',
      'browser.create': 'Create',
      'browser.cancel': 'Cancel',
      'browser.open': 'Open',
      'browser.editPath': 'Edit path',
      'browser.loading': 'Loading…',
      'browser.truncated': 'Too many folders to list; only the beginning is shown.',
      'browser.showHidden': 'Show hidden files',
    })
    let disposePt: () => void
    try {
      disposePt = ctx.locale.register(LOCALE_NS, 'pt', {
        'browser.title': 'Selecionar a pasta do workspace',
        'browser.home': 'Pasta pessoal',
        'browser.newFolder': 'Nova pasta',
        'browser.folderName': 'Nome da pasta',
        'browser.createIn': 'Nova pasta em "{name}"',
        'browser.untitledFolder': 'Pasta sem título',
        'browser.create': 'Criar',
        'browser.cancel': 'Cancelar',
        'browser.open': 'Abrir',
        'browser.editPath': 'Editar o caminho',
        'browser.loading': 'Carregando…',
        'browser.truncated': 'Há pastas demais para listar; só o início aparece.',
        'browser.showHidden': 'Mostrar arquivos ocultos',
      })
    } catch (error) {
      disposeEn()
      throw error
    }
    return () => {
      disposePt()
      disposeEn()
    }
  }, 'directory-picker-browse: dialog dictionaries')

  const injected = (): BrowseFlowInjected => ({
    listDirectory: (path, signal) => ctx.workspaces.listDirectory(path, signal),
    createDirectory: (path, name) => ctx.workspaces.createDirectory(path, name),
    t: ctx.locale.bind(LOCALE_NS),
  })
  // Both declaration lifetimes must be live before the pair installs; the
  // generator makes the two registrations one transactional effect. The
  // outer/inner nesting order is arbitrary; neither hole has precedence.
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.directoryFlow', inject: injected,
      }, BrowseDirectoryFlow)
      yield ctx.slots.register({
        name: 'sidebar.workspaces.directoryFlow', inject: injected,
      }, BrowseDirectoryFlow)
    }))
}
