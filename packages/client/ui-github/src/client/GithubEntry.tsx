/** Settings repository browsing uses shared metadata and the Git-owned workspace selection. */
import { useEffect } from 'react'
import type { GithubProps } from './props.ts'
import css from './GithubEntry.module.css'

/** Render explicit repository/workspace choices without owning account authorization.
 * @param props - Four framework-derived props shares.
 * @returns The GitHub repository view within Settings.
 */
export function GithubEntry(props: GithubProps) {
  const { workspaceId, selectWorkspace, useWorkspaces, useStore, useGithub, actions, t, refresh, more } = props
  const view = useGithub(state => state)
  const choices = useStore(state => state)
  const workspaces = useWorkspaces(state => state)
  const workspace = workspaces.items.find(row => row.workspaceId === workspaceId)
  const repository = view.repositories.find(row => row.id === choices.repositoryId)
  useEffect(() => {
    if (choices.repositoryId !== null && !repository && view.phase !== 'loading') actions.selectRepository(null)
  }, [choices.repositoryId, repository, view.phase, actions])
  return <section className={css.root} aria-label={t('repositoriesTitle')}>
    <header className={css.header}><h3>{t('repositoriesTitle')}</h3>
      <button type="button" className={css.control} disabled={view.phase === 'loading'} onClick={() => { void refresh() }}>{t('refreshRepositories')}</button>
    </header>
    {(view.phase === 'loading' || view.phase === 'stale') && <p role="status">{t(view.phase)}</p>}
    {view.error && <p role="alert">{t('readError')}</p>}
    <label>{t('workspace')}<select className={css.control} value={workspace?.workspaceId ?? ''} onChange={(event) => {
      actions.selectRepository(null)
      selectWorkspace(workspaces.items.find(row => row.workspaceId === event.target.value)?.workspaceId ?? null)
    }}><option value="">{t('choose')}</option>{workspaces.items.map(row => <option key={row.workspaceId} value={row.workspaceId}>{row.title}</option>)}</select></label>
    <label>{t('repository')}<select className={css.control} value={repository?.id ?? ''} disabled={view.account?.state !== 'connected'} onChange={(event) => {
      actions.selectRepository(view.repositories.find(row => row.id === event.target.value)?.id ?? null)
    }}><option value="">{t('choose')}</option>{view.repositories.map(row => <option key={row.id} value={row.id}>{row.owner}/{row.name}</option>)}</select></label>
    {workspace && repository && <p>{t('workspace')}: {workspace.title} · {t('repository')}: {repository.owner}/{repository.name}<br />{t('pair')}</p>}
    <ul className={css.list}>{view.repositories.map(row => <li key={row.id} className={css.metadata}>
      <strong>{row.owner}/{row.name}</strong><span>{row.private ? t('private') : t('public')}</span>
      <span>{t('branch')}: {row.defaultBranch ?? t('none')}</span><span>{row.webUrl}</span>
    </li>)}</ul>
    {view.account?.state === 'connected' && view.repositories.length === 0 && <p>{t('noRepositories')}</p>}
    <button type="button" className={css.control} disabled={view.nextPage === null || view.phase !== 'ready'} onClick={() => { void more() }}>{t('more')}</button>
  </section>
}
