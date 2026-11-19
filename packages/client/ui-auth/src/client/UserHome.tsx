/** Private owner HTTP shell available even when execution is not granted. */
import { useState, type ReactNode } from 'react'
import type { UserHomeProps, UserHomeAccountProps } from './contract.ts'
import { Account } from './forms.tsx'
import css from './Auth.module.css'
export function UserHome(props: UserHomeProps): ReactNode {
  const [page, setPage] = useState<'projects' | 'account'>('projects')
  return <main className={css.admin} data-auth-composition="user">
    <header className={css.header}><h1>{props.t('projects')}</h1>
      <nav className={css.nav} aria-label={props.t('account')}>
        <button className={css.button} type="button" aria-pressed={page === 'projects'} onClick={() => { setPage('projects') }}>{props.t('projects')}</button>
        <button className={css.button} type="button" aria-pressed={page === 'account'} onClick={() => { setPage('account') }}>{props.t('account')}</button>
        <button className={css.button} type="button" onClick={() => { void props.logout().catch(() => {}) }}>{props.t('signout')}</button>
      </nav>
    </header>
    <div className={css.content}>{props.renderSlot('auth.user.page', {}, { entryKey: page })}</div>
  </main>
}
export function UserHomeAccount(props: UserHomeAccountProps): ReactNode { return <Account {...props} /> }
