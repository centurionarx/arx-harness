/** Credential forms own only transient input/focus state; commands arrive through props. */
import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { TranslateNS } from '@arx-ai/arx-client-ui-slots'
import { AuthHttpError } from '../browser.ts'
import { authErrorCode } from './errors.ts'
import type { PublicProps, AccountProps, FooterProps, AdminAccountProps, UserHomeAccountProps, AccountFooterProps } from './contract.ts'
import type { AuthView, PublicAuthRoute } from '../browser.ts'
import css from './Auth.module.css'

/** Sanitized code-to-copy projection; server messages/credentials never enter UI errors. */
export function ErrorMessage(props: { code: string | undefined; t: TranslateNS<'auth'> }): ReactNode {
  if (props.code === undefined) return null
  const key = props.code === 'PASSWORD_MISMATCH' ? 'mismatch'
    : props.code === 'FORBIDDEN' ? 'forbidden'
      : props.code === 'QUOTA_EXCEEDED' ? 'quota'
        : props.code.includes('TOKEN') || props.code.includes('INVITATION') ? 'tokenInvalid'
          : props.code.includes('LOGIN') || props.code.includes('CREDENTIAL') ? 'invalid'
            : props.code.includes('SESSION') || props.code === 'AUTH_REQUIRED' ? 'expired' : 'error'
  return <p className={css.error} role="alert">{props.t(key)}</p>
}

function useSubmission() {
  const live = useRef(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState(false)
  useLayoutEffect(() => () => { live.current = false }, [])
  const submit = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true); setError(undefined); setDone(false)
    try {
      await operation()
      if (live.current) setDone(true)
    } catch (cause) {
      if (live.current) setError(authErrorCode(cause))
    } finally {
      if (live.current) setBusy(false)
    }
  }
  return { busy, error, done, submit }
}

function LoginForm(props: PublicProps & { route: PublicAuthRoute; navigate(route: PublicAuthRoute): void }): ReactNode {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const operation = useSubmission()
  const recovery = props.route === 'forgot'
  const setPasswordMode = props.route === 'reset' || props.route === 'invitation'
  const title = props.route === 'login' ? 'login' : props.route === 'forgot' ? 'recover'
    : props.route === 'reset' ? 'reset' : 'invitation'
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    const enteredPassword = password
    setPassword(''); setConfirmation('')
    void operation.submit(async () => {
      if (setPasswordMode && enteredPassword !== confirmation) throw new AuthHttpError(400, 'PASSWORD_MISMATCH')
      if (props.route === 'login') await props.login(identifier.trim(), enteredPassword)
      else if (props.route === 'forgot') await props.forgot(identifier.trim())
      else if (props.route === 'reset') await props.reset(enteredPassword)
      else await props.accept(enteredPassword)
    })
  }
  return <div className={css.card}>
    <h1>{props.t(title)}</h1>
    <form className={css.form} onSubmit={onSubmit} aria-busy={operation.busy}>
      {!setPasswordMode && <label className={css.field}>{props.t('identifier')}
        <input autoFocus autoComplete="username" required maxLength={254} value={identifier}
          onChange={(event) => { setIdentifier(event.target.value) }} disabled={operation.busy || operation.done} />
      </label>}
      {!recovery && <label className={css.field}>{props.t(setPasswordMode ? 'newPassword' : 'password')}
        <input autoFocus={setPasswordMode} type="password" autoComplete={setPasswordMode ? 'new-password' : 'current-password'}
          required maxLength={1024} value={password} onChange={(event) => { setPassword(event.target.value) }}
          disabled={operation.busy || operation.done} />
      </label>}
      {setPasswordMode && <label className={css.field}>{props.t('confirmPassword')}
        <input type="password" autoComplete="new-password" required maxLength={1024} value={confirmation}
          onChange={(event) => { setConfirmation(event.target.value) }} disabled={operation.busy || operation.done} />
      </label>}
      <ErrorMessage code={operation.error} t={props.t} />
      {operation.done && <p role="status" className={css.notice}>{props.t(recovery ? 'recoveryAccepted' : 'passwordSaved')}</p>}
      <button className={[css.button, css.primary].join(' ')} type="submit" disabled={operation.busy || operation.done}>
        {props.t(operation.busy ? 'busy' : title)}
      </button>
    </form>
    {props.route === 'login'
      ? <button className={css.link} type="button" onClick={() => { props.navigate('forgot') }}>{props.t('forgot')}</button>
      : <button className={css.link} type="button" onClick={() => { props.navigate('login') }}>{props.t('back')}</button>}
  </div>
}

export function PasswordForm(props: Pick<PublicProps, 'change' | 't'>): ReactNode {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const operation = useSubmission()
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    const enteredCurrent = current; const enteredPassword = password
    setCurrent(''); setPassword(''); setConfirmation('')
    void operation.submit(async () => {
      if (enteredPassword !== confirmation) throw new AuthHttpError(400, 'PASSWORD_MISMATCH')
      await props.change(enteredCurrent, enteredPassword)
    })
  }
  return <form className={css.form} onSubmit={onSubmit} aria-busy={operation.busy}>
    <label className={css.field}>{props.t('currentPassword')}
      <input autoFocus type="password" autoComplete="current-password" required maxLength={1024}
        value={current} onChange={(event) => { setCurrent(event.target.value) }} disabled={operation.busy} />
    </label>
    <label className={css.field}>{props.t('newPassword')}
      <input type="password" autoComplete="new-password" required maxLength={1024}
        value={password} onChange={(event) => { setPassword(event.target.value) }} disabled={operation.busy} />
    </label>
    <label className={css.field}>{props.t('confirmPassword')}
      <input type="password" autoComplete="new-password" required maxLength={1024}
        value={confirmation} onChange={(event) => { setConfirmation(event.target.value) }} disabled={operation.busy} />
    </label>
    <ErrorMessage code={operation.error} t={props.t} />
    <button className={[css.button, css.primary].join(' ')} type="submit" disabled={operation.busy}>
      {props.t(operation.busy ? 'busy' : 'changePassword')}
    </button>
  </form>
}

export function PublicRoot(props: PublicProps): ReactNode {
  const auth = props.useAuth(snapshot => snapshot)
  if (auth.recovery?.phase === 'checking') return <main className={css.page} data-auth-composition="public">
    <p role="status">{props.t('checkingRecovery')}</p>
  </main>
  const revision = auth.recovery?.revision ?? 0
  return <PublicFormPage {...props} key={revision} initialRoute={auth.recovery?.route ?? props.initialRoute}
    auth={auth} revision={revision} />
}

function PublicFormPage(props: PublicProps & { auth: AuthView; revision: number }): ReactNode {
  const auth = props.auth
  const [route, setRoute] = useState<PublicAuthRoute>(props.initialRoute)
  const commands: PublicProps = {
    ...props,
    login: (identifier, password) => props.login(identifier, password, props.revision),
    forgot: identifier => props.forgot(identifier, props.revision),
    reset: password => props.reset(password, props.revision),
    accept: password => props.accept(password, props.revision),
    change: (current, password) => props.change(current, password, props.revision),
    logout: () => props.logout(props.revision),
    returnToEntry: () => { props.returnToEntry(props.revision) },
  }
  const navigate = (next: PublicAuthRoute): void => {
    if (next === 'login') { commands.returnToEntry(); return }
    setRoute(next)
  }
  const recovering = route === 'reset' || route === 'invitation'
  return <main className={css.page} data-auth-composition="public">
    {!recovering && auth.phase === 'change-password' ? <section className={css.card}>
      <h1>{props.t('changePassword')}</h1><p>{props.t('firstPassword')}</p>
      <PasswordForm change={commands.change} t={props.t} />
      <button className={css.link} type="button" onClick={() => { void commands.logout().catch(() => {}) }}>{props.t('signout')}</button>
    </section> : !recovering && auth.phase === 'pending' ? <section className={css.card}>
      <h1>{props.t('login')}</h1><p role="status">{props.t('pending')}</p>
      <button className={css.button} type="button" onClick={() => { void commands.logout().catch(() => {}) }}>{props.t('signout')}</button>
    </section> : <LoginForm {...commands} route={route} navigate={navigate} key={route} />}
  </main>
}

export function Account(props: AccountProps | AdminAccountProps | UserHomeAccountProps | AccountFooterProps): ReactNode {
  const principal = props.useAuth(snapshot => snapshot.principal)
  if (principal === undefined) return null
  return <section className={css.account} aria-label={props.t('account')}>
    <h2>{props.t('account')}</h2>
    <dl><dt>{props.t('username')}</dt><dd>{principal.username}</dd>
      <dt>{props.t('email')}</dt><dd>{principal.email}</dd>
      <dt>{props.t('grants')}</dt><dd>{principal.grants.length === 0 ? props.t('noGrants') : principal.grants.join(', ')}</dd>
    </dl>
    <PasswordForm change={props.change} t={props.t} />
    <button className={css.button} type="button" onClick={() => { void props.logout().catch(() => {}) }}>{props.t('signout')}</button>
  </section>
}

export function LogoutFooter(props: FooterProps): ReactNode {
  return <button className={css.button} type="button" title={props.t('signout')} aria-label={props.t('signout')}
    onClick={() => { void props.logout().catch(() => {}) }}>{props.wide ? props.t('signout') : '↪'}</button>
}

/** Account is reachable without mounting the operator Settings shell. */
export function AccountFooter(props: AccountFooterProps): ReactNode {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!open) return
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { if (trigger.current?.isConnected) trigger.current.focus() }
  }, [open])
  return <>
    <button ref={trigger} className={css.button} type="button" title={props.t('account')}
      aria-label={props.t('account')} aria-haspopup="dialog" onClick={() => { setOpen(true) }}>
      {props.wide ? props.t('account') : '◉'}
    </button>
    {open && <div ref={dialog} className={css.historyBackdrop} role="dialog" aria-modal="true"
      aria-labelledby={titleId} onKeyDown={(event) => {
        if (event.key === 'Escape') { setOpen(false); return }
        if (event.key !== 'Tab') return
        /* v8 ignore next -- `?? []` arm: the keydown handler runs only while the mounted dialog holds the ref. */
        const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])]
        const first = nodes[0], last = nodes.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
      <div className={css.accountDialog}>
        <div className={css.row}><h1 id={titleId}>{props.t('account')}</h1>
          <button type="button" className={css.button} onClick={() => { setOpen(false) }}>{props.t('close')}</button>
        </div>
        <Account {...props} />
      </div>
    </div>}
  </>
}
