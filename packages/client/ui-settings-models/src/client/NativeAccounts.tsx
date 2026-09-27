/** Native product account controls; all credentials stay with the native product. */
import { useEffect, useId, useState } from 'react'
import type { InjectFace, PropsLocale } from '@arx-ai/arx-client-ui-slots'
import type { NativeAccountAttempt, NativeAccountProvider, NativeLoginMode } from '@arx-ai/arx-api-remotes/client'
import type { HostDescriptionSource } from '@arx-ai/arx-client-connection/client'
import type { NativeAccountsStore } from './native-accounts-store.ts'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/**
 * Copy per line an attempt can request. `hint` is the caption that says what to paste, and
 * `rejected` the message shown while a prompt repeats because the last answer was not accepted;
 * a line without them shows the field and its submit button alone.
 */
interface InputCopy { label: ModelsKey; submit: ModelsKey; hint?: ModelsKey; rejected?: ModelsKey }

/** Every wire `input` value has an entry. */
const INPUT_COPY: Record<NonNullable<NativeAccountAttempt['input']>, InputCopy> = {
  code: { label: 'native.authCode', submit: 'native.submitCode' },
  'redirect-url': {
    label: 'native.returnAddress', submit: 'native.submitAddress',
    hint: 'native.returnAddressHint', rejected: 'native.returnAddressRejected',
  },
}

/**
 * Login modes in button order: on a host without a desktop the device code comes first, as the mode
 * that needs nothing pasted back from the browser. Every mode stays offered.
 * @param modes - the modes the account offers, in the host's order.
 * @param headless - whether the host reports no desktop session.
 * @returns The modes to render, in order.
 */
function loginOrder(modes: readonly NativeLoginMode[], headless: boolean): readonly NativeLoginMode[] {
  if (!headless) return modes
  return [...modes.filter(mode => mode === 'device-code'), ...modes.filter(mode => mode !== 'device-code')]
}

export interface NativeAccountsInjected {
  available: boolean
  /** `hostDescription` reports `canOpenPath: false` on a host without a desktop session. */
  hooks: { accounts: NativeAccountsStore['store']; hostDescription: HostDescriptionSource }
  watch: () => () => void
  reload: () => void
  begin: (provider: NativeAccountProvider, mode: NativeLoginMode) => void
  cancel: () => void
  submit: (code: string) => void
  enable: (provider: NativeAccountProvider) => void
}

type Props = InjectFace<NativeAccountsInjected> & PropsLocale<'settings.models'>

/** One settings-owned account card, composed through the Models section child slot. */
export function NativeAccounts({ available, useAccounts, useHostDescription, watch, reload, begin, cancel, submit, enable, t }: Props) {
  const state = useAccounts(value => value)
  const headless = useHostDescription(description => description?.canOpenPath === false)
  const [code, setCode] = useState('')
  const hintId = useId()
  const rejectedId = useId()
  useEffect(() => available ? watch() : undefined, [available, watch])
  if (!available) return null
  const attempt = state.attempt
  const pending = attempt?.state === 'starting' || attempt?.state === 'waiting'
  const copy = attempt?.input === undefined ? undefined : INPUT_COPY[attempt.input]
  const rejectedCopy = attempt?.rejected === true ? copy?.rejected : undefined
  /** Read with the field: the rejection first, then the caption, in the order they render. */
  const describedBy = [...rejectedCopy === undefined ? [] : [rejectedId], ...copy?.hint === undefined ? [] : [hintId]].join(' ')
  return (
    <section className={styles.rowCard} aria-label={t('native.title')}>
      <h3 className={styles.title}>{t('native.title')}</h3>
      <p className={styles.intro}>{t('native.intro')}</p>
      {state.error !== null && <p role="alert" className={styles.error}>{state.error}</p>}
      {state.loading && <p role="status">{t('native.loading')}</p>}
      {state.accounts.map((account) => {
        const route = state.routes[account.provider]
        // The notice weighs the device code against the browser, so an account offering one mode gets none.
        const remote = headless && account.loginModes.includes('device-code') && account.loginModes.includes('browser')
        return (
          <div key={account.provider} className={styles.rowCard}>
            <span>{account.label}</span>
            <span>{account.availability === 'unavailable' ? t('native.unavailable')
              : account.status === 'connected' ? t('native.connected')
                : account.status === 'disconnected' ? t('native.disconnected') : t('native.unknown')}</span>
            {account.authMode !== undefined && <span>{account.authMode === 'subscription'
              ? t('native.subscription') : t('native.apiKey')}</span>}
            {account.status === 'connected' && account.models !== undefined && (
              <span>{account.models.map(model => model.name).join(', ')}</span>
            )}
            {account.provider === 'claude-code' && account.status === 'connected' && account.authMode !== 'subscription'
              && <p className={styles.notice}>{t('native.subscriptionRequired')}</p>}
            {account.provider === 'codex' && route === 'absent' && <p className={styles.notice}>{t('native.codexChatFirst')}</p>}
            {remote && account.availability === 'available' && <p className={styles.notice}>{t('native.remoteSignIn')}</p>}
            <div className={styles.rowActions}>
              {account.status === 'connected' && (account.provider === 'claude-code' || account.authMode === 'subscription') && (
                <button type="button" className={styles.secondaryButton}
                  disabled={state.busy || route === undefined || route === 'current' || (account.provider === 'codex' && route === 'absent')}
                  onClick={() => { enable(account.provider) }}>
                  {route === 'current' ? t('native.enabled') : route === 'stale' ? t('native.update') : t('native.enable')}
                </button>
              )}
              {account.availability === 'available' && loginOrder(account.loginModes, headless).map(mode => (
                <button type="button" key={mode} className={styles.secondaryButton}
                  disabled={pending || state.busy || account.loginInFlight}
                  onClick={() => { setCode(''); begin(account.provider, mode) }}>
                  {mode === 'device-code' ? t('native.deviceLogin') : t('native.browserLogin')}
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {attempt !== null && (
        <div role="status" aria-live="polite">
          <p>{t(`native.attempt.${attempt.state}`)}</p>
          {pending && attempt.url !== undefined && (
            <a href={attempt.url} target="_blank" rel="noopener noreferrer">{t('native.openLogin')}</a>
          )}
          {pending && attempt.code !== undefined && <p>{t('native.deviceCode')}: <code>{attempt.code}</code></p>}
          {pending && copy !== undefined && (
            <form onSubmit={(event) => { event.preventDefault(); submit(code.trim()); setCode('') }}>
              <label>{t(copy.label)}
                <input type="password" autoComplete="off" value={code} aria-describedby={describedBy === '' ? undefined : describedBy}
                  onChange={(event) => { setCode(event.target.value) }} />
              </label>
              {rejectedCopy !== undefined && <p id={rejectedId} className={styles.notice}>{t(rejectedCopy)}</p>}
              {copy.hint !== undefined && <p id={hintId} className={styles.advancedHint}>{t(copy.hint)}</p>}
              <button type="submit" className={styles.secondaryButton} disabled={code.trim() === '' || state.busy}>
                {t(copy.submit)}
              </button>
            </form>
          )}
          {attempt.message !== undefined && <p>{attempt.message}</p>}
          {pending && <button type="button" className={styles.secondaryButton} onClick={cancel}>{t('cancel')}</button>}
        </div>
      )}
      <button type="button" className={styles.secondaryButton} disabled={state.loading} onClick={reload}>{t('native.refresh')}</button>
    </section>
  )
}
