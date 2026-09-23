// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@arx-ai/arx-client-test-runtime'
import { Context } from '@arx-ai/cordis'
import { SettingsSchemaService } from '@arx-ai/arx-client-ui-settings/src/client/schema.ts'
import { SettingsDescribeMirror } from '@arx-ai/arx-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsScopeController } from '@arx-ai/arx-client-ui-settings/src/client/settings-scope.ts'

/** Stateless schema service for scope construction in this jsdom fixture. */
const schemaService = new SettingsSchemaService(new Context())
import { HomeMigrationNotice } from '../src/client/HomeMigrationNotice.tsx'
import type { HomeMigrationNoticeProps } from '../src/client/HomeMigrationNotice.tsx'
import type { HostDescription } from '@arx-ai/arx-client-connection/client'
import { decodeNoticeSection, AcknowledgedNoticeStore } from '../src/client/notice-store.ts'
import type { NoticeSection } from '../src/client/notice-store.ts'
import { en } from '../src/client/locales.ts'
import {
  HOME_MIGRATION_ACK_FIELD, HOME_MIGRATION_NOTICE_COPY, WELCOME_NOTICE_SETTINGS_NAMESPACE,
} from '../src/onboarding-copy.ts'

/** The copy this installation made, as `host.describe` reports it. */
const MIGRATION = { fromDisplay: '~/.cxh', toDisplay: '~/.arx', at: '2026-09-22T10:00:00.000Z' }

/** The notice body with the Host's own symbolic home names substituted. */
const BODY = HOME_MIGRATION_NOTICE_COPY.en.body
  .replaceAll('{from}', MIGRATION.fromDisplay)
  .replaceAll('{to}', MIGRATION.toDisplay)

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

function response<T>(value: T) {
  return { rpcId: 'home-migration-rpc' as never, result: { ok: true as const, value } }
}

function onboardingView(value: unknown, revision = 0) {
  return {
    ns: WELCOME_NOTICE_SETTINGS_NAMESPACE,
    schema: {},
    value,
    base: {},
    user: {},
    applies: 'live' as const,
    secrets: [],
    revision,
  }
}

/** The Host facts every description carries, beside the copy under test. */
const HOST: HostDescription = {
  version: '1.0.10',
  cwd: '/workspace',
  attachedSessions: 0,
  home: '/home/tester',
  canOpenPath: false,
}

/** A host-description source answering one fixed description. */
function describing(description: HostDescription | undefined) {
  return { getSnapshot: () => description, subscribe: () => () => {} }
}

function mount(options: {
  acknowledgedAt?: string
  description?: HostDescription | undefined
  mutateImpl?: () => Promise<unknown>
} = {}) {
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.append(appRoot)
  const mutate = vi.fn(options.mutateImpl ?? (() =>
    Promise.resolve(response(onboardingView({ [HOME_MIGRATION_ACK_FIELD]: MIGRATION.at }, 1)))))
  const api = {
    settings: {
      describe: () => Promise.resolve(response({
        writable: true,
        hasDocument: false,
        namespaces: [onboardingView(
          options.acknowledgedAt === undefined ? {} : { [HOME_MIGRATION_ACK_FIELD]: options.acknowledgedAt },
        )],
      })),
      mutate,
    },
  }
  const mirror = new SettingsDescribeMirror(api as never)
  const scope = new SettingsScopeController<NoticeSection>(
    api as never,
    { namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE, decode: decodeNoticeSection },
    mirror,
    'host',
    schemaService,
  )
  const description = 'description' in options ? options.description : { ...HOST, homeMigration: MIGRATION }
  const hostDescription = describing(description)
  const controller = new AcknowledgedNoticeStore({
    scope,
    field: HOME_MIGRATION_ACK_FIELD,
    version: () => hostDescription.getSnapshot()?.homeMigration?.at ?? '',
    subject: 'home migration',
  })
  void mirror.load()
  const complete = vi.fn()
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  const props: HomeMigrationNoticeProps = {
    stepId: 'home-migration-notice',
    complete,
    openSection: vi.fn(),
    useSessions: unusedHook,
    useWorkspaces: unusedHook,
    controller,
    useHomeMigrationNotice: bindSnapshotSelector(controller.store),
    useHostDescription: bindSnapshotSelector(hostDescription),
    t: key => en[key],
  }
  return { ...render(<HomeMigrationNotice {...props} />), complete, controller, mirror, mutate, appRoot }
}

describe('HomeMigrationNotice', () => {
  it('names the homes the Host reported and no machine path', async () => {
    const h = mount()
    const dialog = await screen.findByRole('dialog', { name: HOME_MIGRATION_NOTICE_COPY.en.title })
    for (const paragraph of BODY.split('\n\n')) {
      expect(screen.getByText(paragraph, { exact: true })).toBeTruthy()
    }
    expect(dialog.textContent).toContain('~/.cxh')
    expect(dialog.textContent).toContain('~/.arx')
    expect(dialog.textContent).not.toContain('{from}')
    expect(dialog.querySelectorAll('button')).toHaveLength(1)
    expect(h.appRoot.inert).toBe(true)
  })

  it('completes without showing anything when the Host reports no copy', async () => {
    const h = mount({ description: HOST })
    await act(async () => { await h.mirror.load() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('waits rather than completing while no description has arrived', async () => {
    const h = mount({ description: undefined })
    await act(async () => { await h.mirror.load() })
    // A reconnecting source reports none; retiring the step here would drop the
    // notice for a user who never saw it.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('completes after the acknowledgement records this copy instant', async () => {
    const h = mount()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: HOME_MIGRATION_NOTICE_COPY.en.continueLabel }))
    await act(async () => { await Promise.resolve() })
    expect(h.mutate).toHaveBeenCalledOnce()
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('skips itself when this exact copy was already acknowledged', async () => {
    const h = mount({ acknowledgedAt: MIGRATION.at })
    await act(async () => {
      await h.mirror.load()
      await h.controller.load()
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.complete).toHaveBeenCalledOnce()
  })

  it('shows again for a copy made after the one already acknowledged', async () => {
    const h = mount({ acknowledgedAt: '2020-01-01T00:00:00.000Z' })
    await act(async () => {
      await h.mirror.load()
      await h.controller.load()
    })
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('reports a refused write and stays open', async () => {
    let resolveWrite!: (value: unknown) => void
    const write = new Promise<unknown>((resolve) => { resolveWrite = resolve })
    const h = mount({ mutateImpl: () => write })
    await screen.findByRole('dialog')
    const action = screen.getByRole<HTMLButtonElement>(
      'button', { name: HOME_MIGRATION_NOTICE_COPY.en.continueLabel },
    )
    fireEvent.click(action)
    expect(action.disabled).toBe(true)
    resolveWrite({
      rpcId: 'home-migration-refused' as never,
      result: {
        ok: false,
        error: {
          code: 'settings-rejected',
          message: 'read only',
          details: { ns: WELCOME_NOTICE_SETTINGS_NAMESPACE },
        },
      },
    })
    expect((await screen.findByRole('alert')).textContent).toBe(en.welcomeError)
    expect(h.complete).not.toHaveBeenCalled()
  })
})
