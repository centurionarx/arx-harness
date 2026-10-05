/** Driven presentation fixtures use the same bare sources and declared stores as the renderer. */
import { createElement, Fragment, useState } from 'react'
import { vi } from 'vitest'
import { act, fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@arx-ai/arx-client-test-runtime'
import { createSnapshotStore, type WorkspaceListState, type WorkspaceId } from '@arx-ai/arx-client-runtime/client'
import { GithubController, type GithubReads } from '../src/client/controller.ts'
import { GithubEntry } from '../src/client/GithubEntry.tsx'
import { GithubAccountSection } from '../src/client/GithubAccountSection.tsx'
import { createGithubViewStore } from '../src/client/store.ts'
import type { GithubAccountProps, GithubProps } from '../src/client/props.ts'
import { en, pt } from '../src/client/locales.ts'
import { auth, reads, wid } from './fixtures.client.ts'

interface PresentationBench {
  carrier: ReturnType<typeof auth>
  controller: GithubController
  view: RenderResult
  refresh(): Promise<void>
}
interface RepositoryBench extends PresentationBench {
  store: ReturnType<ReturnType<typeof createGithubViewStore>['create']>
  workspaces: ReturnType<typeof createSnapshotStore<WorkspaceListState>>
  props: GithubProps
}
interface AccountBench extends PresentationBench {
  props: GithubAccountProps
  open(): Promise<void>
}
export const controllers: GithubController[] = []
function setup(overrides: Partial<GithubReads>, language: 'en' | 'pt') {
  const carrier = auth(); const controller = new GithubController(reads(overrides), carrier); controllers.push(controller)
  const useGithub = bindSnapshotSelector(controller)
  const t = makeTranslate(language === 'en' ? en : pt)
  return { carrier, controller, useGithub, t }
}
export function repositoryBench(overrides: Partial<GithubReads> = {}, language: 'en' | 'pt' = 'en'): RepositoryBench {
  const b = setup(overrides, language)
  const store = createGithubViewStore().create()
  const workspaces = createSnapshotStore<WorkspaceListState>({
    items: ['one', 'two'].map(id => ({ workspaceId: wid(id), path: '/work/' + id, title: id, sessionIds: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' })),
    archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true, recentWorkspaceId: undefined,
  })
  const props: GithubProps = {
    wide: true, expandSidebar: vi.fn(), workspaceId: null, selectWorkspace: vi.fn(), useSessions: () => { throw new Error('unused') },
    useWorkspaces: bindSnapshotSelector(workspaces), useStore: bindSnapshotSelector(store), actions: store.actions,
    useGithub: b.useGithub, t: b.t, refresh: () => b.controller.refresh(), more: () => b.controller.more(), openSettings: vi.fn(),
  }
  function GitOwner() {
    const [workspaceId, setWorkspaceId] = useState<WorkspaceId | null>(null)
    return createElement(Fragment, null,
      createElement('output', { 'data-testid': 'git-workspace' }, workspaceId ?? 'none'),
      createElement(GithubEntry, { ...props, workspaceId, selectWorkspace: (id) => { props.selectWorkspace(id); setWorkspaceId(id) } }),
    )
  }
  const view = render(createElement(GitOwner))
  const refresh = async () => { await act(async () => { await b.controller.refresh() }) }
  return { ...b, store, workspaces, props, view, refresh }
}
export function accountBench(overrides: Partial<GithubReads> = {}, language: 'en' | 'pt' = 'en'): AccountBench {
  const b = setup(overrides, language)
  const props: GithubAccountProps = {
    close: vi.fn(), useSessions: () => { throw new Error('account must not read sessions') },
    useWorkspaces: () => { throw new Error('account must not require any workspace') },
    useGithub: b.useGithub, useAuthorization: bindSnapshotSelector(b.controller.authorizationView), t: b.t,
    refresh: () => b.controller.refreshAccount(), begin: () => b.controller.begin(),
    submit: answer => b.controller.submit(answer), cancel: () => b.controller.cancel(), watch: () => b.controller.watch(),
  }
  const view = render(createElement(GithubAccountSection, props))
  const refresh = async () => { await act(async () => { await b.controller.refreshAccount() }) }
  const open = async () => {
    await refresh()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: language === 'en' ? en.authorize : pt.authorize })); await Promise.resolve() })
  }
  return { ...b, props, view, refresh, open }
}
