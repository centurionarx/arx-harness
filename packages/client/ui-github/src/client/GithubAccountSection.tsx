/** Workspace-independent account settings and a page-owned native authorization dialog. */
import { useEffect, useId, useRef, useState } from 'react'
import type { GithubAccountProps } from './props.ts'
import css from './GithubEntry.module.css'

/** Render account state and caller-owned authorization without owning repository or workspace selection.
 * @param props - Framework-derived settings owner, locale and injected observable shares.
 * @returns The GitHub account settings section.
 */
export function GithubAccountSection(props: GithubAccountProps) {
  const { useGithub, useAuthorization, t, refresh, begin, submit, cancel, watch, renderSlot } = props
  const view = useGithub(state => state)
  const authorization = useAuthorization(state => state)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const source = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const title = useId()
  const warning = useId()
  const prompt = authorization.attempt?.prompt
  const allowed = view.phase === 'ready' && view.account?.state !== 'unconfigured' && view.account?.writable === true && view.flow !== null
  useEffect(watch, [watch])
  useEffect(() => {
    setDraft('')
    const input = field.current
    return () => { if (input) input.value = '' }
  }, [prompt?.id])
  useEffect(() => {
    if (!allowed) { setDraft(''); setOpen(false); void cancel() }
  }, [allowed, cancel])
  useEffect(() => {
    const element = dialog.current
    if (!open || element === null) return
    element.showModal()
    return () => { element.close(); source.current?.focus() }
  }, [open])
  useEffect(() => { if (open && prompt) field.current?.focus() }, [open, prompt?.id])
  const close = (): void => { setDraft(''); if (field.current) field.current.value = ''; setOpen(false); void cancel(); source.current?.focus() }
  return <><section className={css.root} aria-label={t('title')}>
    <header className={css.header}><h2>{t('title')}</h2>
      <button type="button" className={css.control} disabled={view.phase === 'loading'} onClick={() => { void refresh() }}>{t('refresh')}</button>
    </header>
    <p role="status">{view.account ? t(view.account.state) : t(view.phase === 'error' ? 'readError' : view.phase === 'loading' ? 'loading' : view.phase === 'stale' ? 'stale' : 'cold')}</p>
    {view.error && <p role="alert">{t('readError')}</p>}
    {view.account?.account && <p className={css.metadata}>{view.account.account.login}<br />{view.account.account.webUrl}</p>}
    {view.account && !view.account.writable && view.account.state !== 'unconfigured' && <p>{t('readonly')}</p>}
    <button ref={source} type="button" className={css.control} disabled={!allowed || authorization.busy} onClick={() => {
      setDraft(''); setOpen(true); void begin()
    }}>{t('authorize')}</button>
    {open && <dialog ref={dialog} className={css.dialog} aria-labelledby={title} aria-describedby={warning}
      onCancel={(event) => { event.preventDefault(); close() }} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); return }
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select')].filter(control => !control.matches(':disabled'))
        const active = event.currentTarget.ownerDocument.activeElement
        const target = event.shiftKey ? controls.at(-1) : controls[0]
        if (target && (!controls.some(control => control === active)
          || (event.shiftKey ? active === controls[0] : active === controls.at(-1)))) {
          event.preventDefault(); target.focus()
        }
      }}>
      <h2 id={title}>{t('authTitle')}</h2><p id={warning}>{t('warning')}</p>
      {authorization.attempt && <p role="status">{t(authorization.attempt.state)}</p>}
      {authorization.attempt?.notice && <p>{authorization.attempt.notice.message}</p>}
      {authorization.error && <p role="alert">{t('authError')}</p>}
      <form onSubmit={(event) => { event.preventDefault(); const answer = draft; setDraft(''); if (field.current) field.current.value = ''; void submit(answer) }}>
        {prompt && <label>{prompt.message}{prompt.kind === 'select'
          ? <select className={css.control} value={draft} disabled={authorization.busy}
            onChange={(event) => { setDraft(event.target.value) }}>
            <option value="">{t('choose')}</option>{prompt.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          : <input ref={field} className={css.control} type="password" autoComplete="off" aria-label={t('pat')} value={draft}
            disabled={authorization.busy} onChange={(event) => { setDraft(event.target.value) }} />}</label>}
        <button type="submit" className={css.control} disabled={!prompt || !draft || authorization.busy}>{t('submit')}</button>
        <button type="button" className={css.control} onClick={close}>{t('cancel')}</button>
      </form>
    </dialog>}
  </section>{renderSlot('settings.github.repository', {})}</>
}
