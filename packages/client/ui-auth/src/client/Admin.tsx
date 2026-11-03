/** Administration contains identity metadata and the deployed module catalog only. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { AdminProps, AdminPageProps, AdminAccountProps } from './contract.ts'
import type { WebUserId, WebUserStatus } from '@arx-ai/arx-web-identity/contract'
import { Account, ErrorMessage } from './forms.tsx'
import css from './Auth.module.css'

export function AdminRoot(props: AdminProps): ReactNode {
  const state = props.useStore(snapshot => snapshot)
  useEffect(() => { props.refresh() }, [props.refresh])
  return <main className={css.admin} data-auth-composition="admin">
    <header className={css.header}>
      <div><h1>{props.t('admin')}</h1><p>{props.t('adminPurpose')}</p></div>
      <nav className={css.nav} aria-label={props.t('adminPurpose')}>
        {(['users', 'modules', 'account'] as const).map(page =>
          <button type="button" className={css.button} aria-pressed={state.page === page}
            onClick={() => { props.actions.select(page) }} key={page}>{props.t(page)}</button>)}
        <button type="button" className={css.button} onClick={() => { void props.logout().catch(() => {}) }}>{props.t('signout')}</button>
      </nav>
    </header>
    <div className={css.content}>
      <ErrorMessage code={state.error} t={props.t} />
      {state.notice !== undefined && <p role="status" className={css.notice}>{props.t(state.notice)}</p>}
      {props.renderSlot('auth.admin.page', {}, { entryKey: state.page })}
    </div>
  </main>
}
function statusKey(status: WebUserStatus): 'active' | 'blocked' | 'deleted' | 'pendingLabel' {
  return status === 'ACTIVE' ? 'active' : status === 'BLOCKED' ? 'blocked' : status === 'DELETED' ? 'deleted' : 'pendingLabel'
}
export function AdminUsers(props: AdminPageProps): ReactNode {
  const state = props.useStore(snapshot => snapshot)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [deleteId, setDeleteId] = useState<WebUserId>()
  const [editId, setEditId] = useState<WebUserId>()
  const [invitationEmail, setInvitationEmail] = useState('')
  const create = (event: FormEvent): void => {
    event.preventDefault()
    props.create(username.trim(), email.trim())
    setUsername(''); setEmail('')
  }
  return <section className={css.section} aria-labelledby="arx-admin-users-title">
    <h2 id="arx-admin-users-title">{props.t('users')}</h2>
    <form className={css.inlineForm} onSubmit={create} aria-busy={state.busy}>
      <label className={css.field}>{props.t('username')}
        <input required autoComplete="off" maxLength={80} value={username} onChange={(e) => { setUsername(e.target.value) }} disabled={state.busy} />
      </label>
      <label className={css.field}>{props.t('email')}
        <input type="email" required autoComplete="off" maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value) }} disabled={state.busy} />
      </label>
      <button className={[css.button, css.primary].join(' ')} disabled={state.busy} type="submit">{props.t('createUser')}</button>
      <button className={css.button} type="button" onClick={() => { props.refresh() }} disabled={state.busy}>{props.t('refresh')}</button>
    </form>
    <ul className={css.list}>
      {state.users.filter(user => user.role === 'USER').map(user => <li className={css.user} key={user.userId}>
        <div><strong>{user.username}</strong><p>{user.email}</p>
          <span className={css.secondary}>{props.t('status')}: {props.t(statusKey(user.status))}</span>
        </div>
        {user.status !== 'DELETED' && <div className={css.row}>
          <button className={css.button} type="button" disabled={state.busy}
            onClick={() => { props.status(user.userId, user.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE') }}>
            {props.t(user.status === 'ACTIVE' ? 'block' : 'activate')}
          </button>
          {!user.passwordEstablished && <button className={css.button} type="button" disabled={state.busy}
            onClick={() => { props.invite(user.userId) }}>{props.t('invitationSend')}</button>}
          {user.status === 'PENDING' && !user.passwordEstablished && <button className={css.button} type="button" disabled={state.busy}
            onClick={() => { setEditId(user.userId); setInvitationEmail(user.email) }}>{props.t('invitationEmail')}</button>}
          <button className={css.button} type="button" disabled={state.busy} onClick={() => {
            if (deleteId === user.userId) { props.status(user.userId, 'DELETED'); setDeleteId(undefined) }
            else setDeleteId(user.userId)
          }}>{props.t(deleteId === user.userId ? 'confirmDeleteAccess' : 'deleteAccess')}</button>
        </div>}
        {editId === user.userId && <form className={css.inlineForm} onSubmit={(event) => {
          event.preventDefault(); props.invitationEmail(user.userId, invitationEmail.trim()); setEditId(undefined)
        }}>
          <label className={css.field}>{props.t('email')}<input type="email" required maxLength={254}
            value={invitationEmail} onChange={(event) => { setInvitationEmail(event.target.value) }} /></label>
          <button className={css.button} type="submit" disabled={state.busy}>{props.t('save')}</button>
        </form>}
      </li>)}
    </ul>
    {state.users.length === 0 && !state.busy && <p>{props.t('noUsers')}</p>}
    {state.nextCursor !== undefined && <button className={css.button} type="button" disabled={state.busy}
      onClick={() => { props.refresh(state.nextCursor) }}>{props.t('more')}</button>}
  </section>
}
export function AdminModules(props: AdminPageProps): ReactNode {
  const state = props.useStore(snapshot => snapshot)
  const [selected, setSelected] = useState<string>('')
  const user = state.users.find(row => row.userId === selected && row.role === 'USER' && row.status !== 'DELETED')
  return <section className={css.section} aria-labelledby="arx-admin-modules-title">
    <h2 id="arx-admin-modules-title">{props.t('modules')}</h2>
    <label className={css.field}>{props.t('selectUser')}
      <select value={selected} onChange={(event) => { setSelected(event.target.value) }} disabled={state.busy}>
        <option value="">{props.t('selectUser')}</option>
        {state.users.filter(row => row.role === 'USER' && row.status !== 'DELETED').map(row =>
          <option value={row.userId} key={row.userId}>{row.username}</option>)}
      </select>
    </label>
    <ul className={css.list}>{state.modules.map(module => <li className={css.user} key={module.id}>
      <label className={css.check}><input type="checkbox" checked={user?.grants.includes(module.id) ?? false}
        disabled={user === undefined || state.busy} onChange={(event) => {
          if (user === undefined) return
          props.modules(user.userId, event.target.checked ? [...user.grants, module.id] : user.grants.filter(id => id !== module.id))
        }} />{module.label}</label>
      <span className={css.secondary}>{module.operations.join(', ')}</span>
    </li>)}</ul>
    {state.modules.length === 0 && <p>{props.t('noModules')}</p>}
    {state.nextCursor !== undefined && <button className={css.button} type="button" disabled={state.busy}
      onClick={() => { props.refresh(state.nextCursor) }}>{props.t('more')}</button>}
  </section>
}
export function AdminAccount(props: AdminAccountProps): ReactNode { return <Account {...props} /> }
