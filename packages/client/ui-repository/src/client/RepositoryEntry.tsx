/** Read-only workspace Git presentation; every live fact arrives through framework hooks. */
import { useEffect, useId, useRef } from 'react'
import clsx from 'clsx'
import { Button } from '@arx-ai/arx-client-ui-primitives'
import type { WorkspaceId } from '@arx-ai/arx-client-runtime/client'
import type { RepositoryDiffRequest } from '@arx-ai/arx-repository/types'
import type { RepositoryProps } from './props.ts'
import css from './RepositoryEntry.module.css'

/** Render the independent repository seat.
 * @param props - Framework owner, store, private inject and locale shares.
 * @returns Workspace selector, status groups and escaped unified comparison.
 */
export function RepositoryEntry(props: RepositoryProps) {
  const { wide, expandSidebar, useWorkspaces, useStore, useRepository, actions, select, cancel, show, close, refresh, t } = props
  const { renderSlot } = props
  const chooseWorkspace = (id: WorkspaceId | null): void => { actions.selectWorkspace(id) }
  const workspaces = useWorkspaces(state => state)
  const selection = useStore(state => state)
  const repository = useRepository(state => state)
  const workspace = workspaces.items.find(item => item.workspaceId === selection.workspaceId)
  const workspaceId = workspace?.workspaceId ?? null
  const selector = useRef<HTMLSelectElement>(null)
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const modalContent = useRef<HTMLDivElement>(null)
  const dialogTitle = useId()
  const dialogDescription = useId()
  const focusOnExpand = useRef(false)
  useEffect(() => {
    select(workspaceId)
    actions.selectFile(null)
    if (workspaceId !== null) void refresh()
    return cancel
  }, [workspaceId, select, cancel, refresh, actions])
  useEffect(() => {
    if (selection.workspaceId !== null && workspaceId === null && workspaces.state !== 'loading') actions.selectWorkspace(null)
  }, [selection.workspaceId, workspaceId, workspaces.state, actions])
  useEffect(() => {
    if (wide && focusOnExpand.current) { selector.current?.focus(); focusOnExpand.current = false }
  }, [wide])
  const current = repository.workspaceId === workspaceId
  const inspection = current ? repository.inspection : null
  const status = current ? repository.status : null
  const comparison = current ? repository.comparison : null
  const selectedFile = selection.selectedFile
  const modalOpen = wide && selectedFile !== null && comparison !== null
    && selectedFile.workspaceId === workspaceId && comparison.request.path === selectedFile.path
    && comparison.request.side === selectedFile.side
  useEffect(() => {
    const element = dialog.current
    if (element === null || !modalOpen) return
    element.showModal()
    modalContent.current?.focus()
    return () => {
      element.close()
      returnFocus.current?.focus()
    }
  }, [modalOpen])
  const closeModal = (): void => {
    actions.selectFile(null)
    close()
    returnFocus.current?.focus()
  }
  useEffect(() => {
    if (!wide) { close(); actions.selectFile(null) }
  }, [wide, close, actions])
  const phase = current ? repository.phase : 'cold'
  const groups = ['staged', 'unstaged', 'untracked', 'unmerged'] as const
  const count = status ? groups.reduce((sum, group) => sum + status[group].length, 0) : 0
  const openFile = (request: RepositoryDiffRequest, button: HTMLButtonElement): void => {
    returnFocus.current = button
    actions.selectFile(request)
    void show(request)
  }
  if (!wide) return <button type="button" className={clsx(css.button, css.rail)} aria-label={t('expand')} onClick={() => {
    focusOnExpand.current = true
    expandSidebar()
  }}>Git</button>
  return <section className={css.root} aria-label={t('title')}>
    {renderSlot('repository.github', { wide, expandSidebar, workspaceId, selectWorkspace: chooseWorkspace })}
    <div className={css.header}>
      <strong>{t('title')}</strong>
      <button type="button" className={css.button} disabled={workspaceId === null || phase === 'loading'} onClick={() => {
        actions.selectFile(null)
        void refresh()
      }}>{phase === 'error' || phase === 'not-repository' ? t('retry') : t('refresh')}</button>
    </div>
    <select ref={selector} className={css.selector} aria-label={t('workspace')} value={workspaceId ?? ''}
      disabled={workspaces.items.length === 0} onChange={(event) => {
        const selected = workspaces.items.find(item => item.workspaceId === event.target.value)
        chooseWorkspace(selected?.workspaceId ?? null)
      }}>
      <option value="">{t('choose')}</option>
      {workspaces.items.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}
    </select>
    <div className={css.scroll} aria-busy={phase === 'loading'}>
      {workspaces.state === 'loading' && <p role="status">{t('workspaceLoading')}</p>}
      {workspaces.error && <p role="alert">{workspaces.error.message}</p>}
      {workspaces.items.length === 0 && workspaces.state !== 'loading' && <p>{t('noWorkspace')}</p>}
      {workspace && <div className={css.metadata}>
        <strong>{workspace.title}</strong>
        {inspection && <>
          <span>{inspection.branch ?? t('detached')}</span>
          <code>{inspection.head ?? t('unborn')}</code>
          <span>{inspection.root}</span>
          {inspection.aheadBehind && <span>{t('aheadBehind', inspection.aheadBehind)}</span>}
          {inspection.remotes.map(remote => <span key={remote.name}>{remote.name} · {remote.host ?? '—'} · {remote.transport ?? '—'}</span>)}
        </>}
      </div>}
      {workspaceId === null && workspaces.items.length > 0 && <p>{t('chooseNotice')}</p>}
      {phase === 'loading' && <p role="status">{t('loading')}</p>}
      {phase === 'stale' && <p role="status">{t('stale')}</p>}
      {phase === 'not-repository' && <p role="status">{t('notRepository')}</p>}
      {phase === 'error' && <p role="alert">{repository.error}</p>}
      {phase === 'ready' && status && <>
        {count === 0 && <p>{t('empty')}</p>}
        {groups.map(group => <div key={group} className={css.group}>
          <h3>{t(group)} ({status[group].length})</h3>
          {status[group].map((entry) => {
            const disabled = group === 'unmerged' || entry.submodule !== 'N...'
              || status.unmerged.some(conflict => conflict.path === entry.path)
            const request: RepositoryDiffRequest | null = group === 'unmerged' || workspaceId === null
              ? null : { workspaceId, path: entry.path, side: group }
            return <button key={entry.path} type="button" className={css.file} disabled={disabled}
              title={disabled ? t('unsupported') : entry.path}
              aria-label={t(group) + ': ' + entry.path}
              onClick={request === null ? undefined : (event) => { openFile(request, event.currentTarget) }}>
              <code>{entry.xy}</code> <span>{entry.originalPath ? entry.originalPath + ' → ' : ''}{entry.path}</span>
            </button>
          })}
        </div>)}
      </>}
    </div>
    <dialog ref={dialog} aria-labelledby={dialogTitle} aria-describedby={dialogDescription} className={css.dialog}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'))
        const target = controls[event.shiftKey ? controls.length - 1 : 0]
        if (target === undefined) return
        const active = event.currentTarget.ownerDocument.activeElement
        if (!controls.some(control => control === active)
          || (event.shiftKey ? active === controls[0] : active === controls.at(-1))) {
          event.preventDefault()
          target.focus()
        }
      }}
      onCancel={(event) => { event.preventDefault(); closeModal() }}
      onClose={(event) => { if (!event.currentTarget.open) closeModal() }}>
      <div className={css.dialogHeader}>
        <h2 id={dialogTitle}>{t('diff')}</h2>
        <Button size="sm" onClick={closeModal}>{t('close')}</Button>
      </div>
      <p id={dialogDescription} className={css.description}>{selectedFile ? selectedFile.path + ' · ' + t(selectedFile.side) : ''}</p>
      <div ref={modalContent} tabIndex={-1}>
        {comparison?.phase === 'loading' && <p role="status">{t('loading')}</p>}
        {comparison?.phase === 'error' && <div><p role="alert">{comparison.error}</p>
          <Button size="sm" onClick={() => { void show(comparison.request) }}>{t('retry')}</Button></div>}
        {comparison?.value && (comparison.value.binary ? <p>{t('binary')}</p>
          : comparison.value.text === '' ? <p>{t('noDiff')}</p>
            : <pre className={css.patch} tabIndex={0} aria-label={t('diff')}>{comparison.value.text}</pre>)}
      </div>
    </dialog>
  </section>
}
