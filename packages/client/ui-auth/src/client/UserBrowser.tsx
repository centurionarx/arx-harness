/** Own project/workspace/history navigation. No path input or local directory picker. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { StoredSessionSummary } from '@arx-ai/arx-project-storage/contract'
import type { UserBrowserProps, UserHomeBrowserProps } from './contract.ts'
import { ErrorMessage } from './forms.tsx'
import css from './Auth.module.css'

type BrowserProps = UserBrowserProps | UserHomeBrowserProps
function HistoryDialog(props: BrowserProps & { content: string; sessionId: StoredSessionSummary['sessionId']; cursor: string | undefined }): ReactNode {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const previous = document.activeElement
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <div className={css.historyBackdrop} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}
    onKeyDown={(event) => {
      if (event.key === 'Escape') props.actions.closeHistory()
      if (event.key !== 'Tab') return
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      const first = buttons[0]; const last = buttons.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
    <div className={css.row}><h2 id={titleId}>{props.t('history')}</h2>
      <button type="button" className={css.button} onClick={() => { props.actions.closeHistory() }}>{props.t('close')}</button>
    </div>
    <p className={css.secondary}>{props.t('interruptedNote')}</p>
    <pre className={css.historyText}>{props.content.split('\n').filter((line) => {
      // This is a presentation projection, not an SDK parser or a rewritten stored log.
      // The original owner-only bytes/cursors remain available through explicit export.
      try {
        const record: unknown = JSON.parse(line)
        return typeof record !== 'object' || record === null || (record as { type?: unknown }).type !== 'session'
      } catch { return false }
    }).join('\n')}</pre>
    {props.cursor !== undefined && <button type="button" className={css.button}
      onClick={() => { props.history(props.sessionId, props.cursor) }}>{props.t('more')}</button>}
  </div>
}

export function UserBrowser(props: BrowserProps): ReactNode {
  const state = props.useStore(snapshot => snapshot)
  const workspaceCursor = state.workspaceCursor, sessionCursor = state.sessionCursor
  const [projectName, setProjectName] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [deleteId, setDeleteId] = useState<string>()
  const [renameId, setRenameId] = useState<string>()
  const [title, setTitle] = useState('')
  useEffect(() => { props.refreshProjects() }, [props.refreshProjects])
  const createProject = (event: FormEvent): void => {
    event.preventDefault(); props.createProject(projectName.trim()); setProjectName('')
  }
  const createWorkspace = (event: FormEvent): void => {
    event.preventDefault(); props.createWorkspace(workspaceName.trim()); setWorkspaceName('')
  }
  if ('wide' in props && !props.wide) return <button type="button" className={css.button}
    aria-label={props.t('projects')} title={props.t('projects')} onClick={props.expandSidebar}>◫</button>
  return <section className={css.browser} aria-label={props.t('projects')}>
    <h2>{props.t('projects')}</h2>
    <p className={css.secondary}>{props.t('ownStorage')}</p>
    <label className={css.field}>{props.t('projects')}
      <select value={state.projectId ?? ''} onChange={(event) => { props.selectProject(event.target.value) }} disabled={state.busy}>
        <option value="">{props.t('projects')}</option>
        {state.projects.map(project => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}
      </select>
    </label>
    <form className={css.form} onSubmit={createProject}>
      <label className={css.field}>{props.t('projectName')}<input required maxLength={120}
        value={projectName} onChange={(event) => { setProjectName(event.target.value) }} disabled={state.busy} /></label>
      <button className={css.button} disabled={state.busy} type="submit">{props.t('createProject')}</button>
    </form>
    {state.projects.length === 0 && !state.busy && <p className={css.secondary}>{props.t('noProjects')}</p>}
    {state.projectCursor !== undefined && <button className={css.button} type="button" disabled={state.busy}
      onClick={() => { props.refreshProjects(state.projectCursor) }}>{props.t('more')}</button>}
    <div role="status" aria-live="polite" className={css.secondary}>
      {state.busy ? props.t('loading') : state.error !== undefined ? props.t('unavailable') : props.t('serverSaved')}
    </div>
    <ErrorMessage code={state.error} t={props.t} />
    {state.projectId !== undefined && <>
      <h3>{props.t('workspaces')}</h3>
      <form className={css.form} onSubmit={createWorkspace}>
        <label className={css.field}>{props.t('workspaceName')}<input required maxLength={120} value={workspaceName}
          onChange={(event) => { setWorkspaceName(event.target.value) }} disabled={state.busy} /></label>
        <button className={css.button} disabled={state.busy} type="submit">{props.t('createWorkspace')}</button>
      </form>
      <ul className={css.list}>{state.workspaces.map(workspace => <li className={css.user} key={workspace.workspaceId}>
        <strong>{workspace.name}</strong>
        <div className={css.row}>
          <button className={css.button} type="button" disabled={state.busy || !props.projectRuntimeAvailable}
            onClick={() => { props.openWorkspace(workspace.workspaceId) }}>{props.t('openWorkspace')}</button>
          {workspace.grouped && <button className={css.button} type="button" disabled={state.busy}
            onClick={() => { props.ungroup(workspace.workspaceId) }}>{props.t('ungroup')}</button>}
        </div>
      </li>)}</ul>
      <p className={css.secondary}>{props.t('ungroupNote')}</p>
      {state.workspaces.length === 0 && !state.busy && <p>{props.t('noWorkspaces')}</p>}
      {workspaceCursor !== undefined && <button className={css.button} type="button" disabled={state.busy}
        onClick={() => { props.moreWorkspaces(workspaceCursor) }}>{props.t('more')}</button>}
      <h3>{props.t('history')}</h3>
      <p className={css.secondary}>{props.t('interruptedNote')}</p>
      <ul className={css.list}>{state.sessions.map(session => <li className={css.user} key={session.sessionId}>
        <strong>{session.title}</strong>
        <span className={css.secondary}>{props.t('storedRecords', { count: session.nextSeq })}</span>
        <div className={css.row}>
          <button className={css.button} type="button" disabled={state.busy || !props.projectRuntimeAvailable}
            onClick={() => { props.resume(session.sessionId) }}>{props.t('resume')}</button>
          <button className={css.button} type="button" disabled={state.busy || !props.projectRuntimeAvailable}
            onClick={() => { props.fork(session.sessionId) }}>{props.t('fork')}</button>
          <button className={css.button} type="button" disabled={state.busy}
            onClick={() => { props.history(session.sessionId) }}>{props.t('viewHistory')}</button>
          <button className={css.button} type="button" disabled={state.busy}
            onClick={() => { props.export(session.sessionId) }}>{props.t('exportHistory')}</button>
          <button className={css.button} type="button" disabled={state.busy}
            onClick={() => { setRenameId(session.sessionId); setTitle(session.title) }}>{props.t('rename')}</button>
          <button className={css.button} type="button" disabled={state.busy}
            onClick={() => {
              if (deleteId === session.sessionId) { props.deleteSession(session.sessionId); setDeleteId(undefined) }
              else setDeleteId(session.sessionId)
            }}>{props.t(deleteId === session.sessionId ? 'confirmDeleteSession' : 'deleteSession')}</button>
        </div>
        {deleteId === session.sessionId && <p className={css.secondary}>{props.t('deleteNote')}</p>}
        {renameId === session.sessionId && <form className={css.form} onSubmit={(event) => {
          event.preventDefault(); props.rename(session.sessionId, title.trim()); setRenameId(undefined)
        }}><label className={css.field}>{props.t('rename')}<input required maxLength={120}
            value={title} onChange={(event) => { setTitle(event.target.value) }} /></label>
          <button className={css.button} type="submit" disabled={state.busy}>{props.t('save')}</button>
        </form>}
      </li>)}</ul>
      {state.sessions.length === 0 && !state.busy && <p>{props.t('noSessions')}</p>}
      {sessionCursor !== undefined && <button className={css.button} type="button" disabled={state.busy}
        onClick={() => { props.moreSessions(sessionCursor) }}>{props.t('more')}</button>}
    </>}
    {state.history !== undefined && <HistoryDialog {...props} content={state.history.content}
      sessionId={state.history.sessionId} cursor={state.history.cursor} />}
  </section>
}
