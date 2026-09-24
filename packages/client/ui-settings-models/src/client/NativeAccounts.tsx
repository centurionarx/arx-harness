/** Native product account controls; all credentials stay with the native product. */
import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale } from '@arx-ai/arx-client-ui-slots'
import type { NativeAccountProvider, NativeLoginMode } from '@arx-ai/arx-api-remotes/client'
import type { NativeAccountsStore } from './native-accounts-store.ts'
import styles from './ModelsSection.module.css'

export interface NativeAccountsInjected {
  available: boolean
  hooks: { accounts: NativeAccountsStore['store'] }
  watch: () => () => void
  reload: () => void
  begin: (provider: NativeAccountProvider, mode: NativeLoginMode) => void
  cancel: () => void
  submit: (code: string) => void
  enable: () => void
}

type Props = InjectFace<NativeAccountsInjected> & PropsLocale<'settings.models'>

/** One settings-owned account card, composed through the Models section child slot. */
export function NativeAccounts({ available, useAccounts, watch, reload, begin, cancel, submit, enable, t }: Props) {
  const state = useAccounts(value => value)
  const [code, setCode] = useState('')
  useEffect(() => available ? watch() : undefined, [available, watch])
  if (!available) return null
  const attempt = state.attempt
  const pending = attempt?.state === 'starting' || attempt?.state === 'waiting'
  return (
    <section className={styles.rowCard} aria-label={t('native.title')}>
      <h3 className={styles.title}>{t('native.title')}</h3>
      <p className={styles.intro}>{t('native.intro')}</p>
      {state.error !== null && <p role="alert" className={styles.error}>{state.error}</p>}
      {state.loading && <p role="status">{t('native.loading')}</p>}
      {state.accounts.map(account => (
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
          <div className={styles.rowActions}>
            {account.status === 'connected' && account.provider === 'claude-code' && (
              <button type="button" className={styles.secondaryButton}
                disabled={state.busy || account.authMode !== 'subscription' || state.routeEnabled || !account.models?.length}
                onClick={enable}>
                {state.routeEnabled ? t('native.enabled') : t('native.enable')}
              </button>
            )}
            {account.availability === 'available' && account.loginModes.map(mode => (
              <button type="button" key={mode} className={styles.secondaryButton}
                disabled={pending || state.busy || account.loginInFlight}
                onClick={() => { setCode(''); begin(account.provider, mode) }}>
                {mode === 'device-code' ? t('native.deviceLogin') : t('native.browserLogin')}
              </button>
            ))}
          </div>
        </div>
      ))}
      {attempt !== null && (
        <div role="status" aria-live="polite">
          <p>{t(`native.attempt.${attempt.state}`)}</p>
          {pending && attempt.url !== undefined && (
            <a href={attempt.url} target="_blank" rel="noopener noreferrer">{t('native.openLogin')}</a>
          )}
          {pending && attempt.code !== undefined && <p>{t('native.deviceCode')}: <code>{attempt.code}</code></p>}
          {pending && attempt.input === 'code' && (
            <form onSubmit={(event) => { event.preventDefault(); submit(code.trim()); setCode('') }}>
              <label>{t('native.authCode')}
                <input type="password" autoComplete="off" value={code} onChange={(event) => { setCode(event.target.value) }} />
              </label>
              <button type="submit" className={styles.secondaryButton} disabled={code.trim() === '' || state.busy}>
                {t('native.submitCode')}
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
