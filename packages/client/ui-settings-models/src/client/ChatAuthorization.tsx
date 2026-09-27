/** Chat subscription sign-in uses the model adapter's authorization flow, not native CLI login. */
import { useEffect, useState } from 'react'
import type { AuthorizationAttemptView } from '@arx-ai/arx-api-remotes/client'
import type { InjectFace, PropsLocale } from '@arx-ai/arx-client-ui-slots'
import type { HostDescriptionSource } from '@arx-ai/arx-client-connection/client'
import type { ChatAuthorizationStore } from './chat-authorization-store.ts'
import styles from './ModelsSection.module.css'

export interface ChatAuthorizationInjected {
  available: boolean
  /** `hostDescription` reports `canOpenPath: false` on a host without a desktop session. */
  hooks: { authorization: ChatAuthorizationStore['store']; hostDescription: HostDescriptionSource }
  watch: () => () => void
  begin: () => void
  cancel: () => void
  submit: (answer: string) => void
  enable: () => void
  reload: () => void
}

/**
 * Status copy for an attempt. A flow names no browser step until it sends a notice, so an attempt that waits on
 * a question before one, such as the login method, still reads as starting.
 */
function phase(attempt: AuthorizationAttemptView): 'connected' | 'starting' | Exclude<AuthorizationAttemptView['state'], 'authorized'> {
  if (attempt.state === 'authorized') return 'connected'
  return attempt.state === 'waiting' && attempt.notice === undefined ? 'starting' : attempt.state
}

/** Registered as an independent child of the Models settings page. */
export function ChatAuthorization({
  available, useAuthorization, useHostDescription, watch, begin, cancel, submit, enable, reload, t,
}: InjectFace<ChatAuthorizationInjected> & PropsLocale<'settings.models'>) {
  const state = useAuthorization(value => value)
  const headless = useHostDescription(description => description?.canOpenPath === false)
  const [answer, setAnswer] = useState('')
  useEffect(() => available ? watch() : undefined, [available, watch])
  if (!available) return null
  const { attempt, flow } = state
  const pending = attempt?.state === 'starting' || attempt?.state === 'waiting'
  const prompt = attempt?.prompt
  return (
    <section className={styles.rowCard} aria-label={t('chatAuth.title')}>
      <h3 className={styles.title}>{t('chatAuth.title')}</h3>
      <p className={styles.intro}>{t('chatAuth.intro')}</p>
      {flow !== null && headless && <p className={styles.notice}>{t('chatAuth.remoteSignIn')}</p>}
      {state.error !== null && <p role="alert" className={styles.error}>{state.error}</p>}
      {flow === null ? <p>{t('chatAuth.unavailable')}</p> : (
        <>
          <p>{flow.configured && flow.kind === 'grant' ? t('native.connected') : t('native.disconnected')}</p>
          <button type="button" className={styles.secondaryButton}
            disabled={state.busy || pending || flow.inFlight || !flow.writable || !flow.methods.some(method => method.id === 'oauth')}
            onClick={() => { setAnswer(''); begin() }}>{t('chatAuth.connect')}</button>
          {flow.configured && flow.kind === 'grant' && (
            <button type="button" className={styles.secondaryButton} disabled={state.enabled || state.busy}
              onClick={enable}>{state.enabled ? t('native.enabled') : t('native.enable')}</button>
          )}
        </>
      )}
      {attempt !== null && <div role="status" aria-live="polite">
        <p>{t(`native.attempt.${phase(attempt)}`)}</p>
        {pending && attempt.notice !== undefined && <>
          <p>{attempt.notice.message}</p>
          {attempt.notice.url !== undefined && <a href={attempt.notice.url} target="_blank" rel="noopener noreferrer">{t('native.openLogin')}</a>}
          {attempt.notice.code !== undefined && <p>{t('native.deviceCode')}: <code>{attempt.notice.code}</code></p>}
        </>}
        {pending && prompt !== undefined && (prompt.kind === 'select'
          ? <fieldset><legend>{prompt.message}</legend>{prompt.options.map(option => (
            <button key={option.id} type="button" className={styles.secondaryButton} disabled={state.busy}
              onClick={() => { submit(option.id) }}>{option.label}</button>
          ))}</fieldset>
          : <form onSubmit={(event) => { event.preventDefault(); submit(answer); setAnswer('') }}>
            <label>{prompt.message}<input type="password" autoComplete="off" value={answer}
              placeholder={prompt.placeholder} onChange={(event) => { setAnswer(event.target.value) }} /></label>
            <button type="submit" className={styles.secondaryButton} disabled={state.busy || answer === ''}>{t('chatAuth.submit')}</button>
          </form>)}
        {attempt.message !== undefined && <p>{attempt.message}</p>}
        {pending && <button type="button" className={styles.secondaryButton} onClick={cancel}>{t('cancel')}</button>}
      </div>}
      <button type="button" className={styles.secondaryButton} onClick={reload}>{t('native.refresh')}</button>
    </section>
  )
}
