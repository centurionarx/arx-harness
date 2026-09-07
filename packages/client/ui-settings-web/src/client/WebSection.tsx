/**
 * Web search settings section: which provider answers searches and the key
 * each one resolves through, over the seam's directory. The selection writes
 * the `web` section's `searchProvider`; a key writes through the credentials
 * domain under the reference the provider's section names, so no key ever
 * rides a settings response.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { WebSelectionFailureView } from '@arx-ai/arx-api-remotes/client'
import type { InjectFace } from '@arx-ai/arx-client-ui-slots'
import type { ProviderRow, WebSettingsStore } from './store.ts'
import type { WebKey } from './locales.ts'
import styles from './WebSection.module.css'

/** Injected dependencies of {@link WebSection} (slot `inject`). */
export interface WebSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: WebSettingsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: WebSettingsStore['store']
  }
  /** Section copy. */
  t: (key: WebKey) => string
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type WebSectionProps = Partial<InjectFace<WebSectionInjected>>

type WebSectionFace = InjectFace<WebSectionInjected>

/** The copy each selection failure code renders. */
const FAILURE_COPY: Record<WebSelectionFailureView, WebKey> = {
  WEB_PROVIDER_CONFIGURED_MISSING: 'failureConfiguredMissing',
  WEB_PROVIDER_CONFIGURED_UNAVAILABLE: 'failureConfiguredUnavailable',
  WEB_PROVIDER_UNAVAILABLE: 'failureUnavailable',
  WEB_PROVIDER_AMBIGUOUS: 'failureAmbiguous',
}

/**
 * Fill the `{name}` placeholders a copy string carries.
 * @param template - the dictionary string.
 * @param values - placeholder values by name.
 * @returns the filled string.
 */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

/**
 * Render the section, or nothing until the shell injects its dependencies.
 * @param props - the inject face, present once the slot binds it.
 * @returns the section, or null before injection.
 */
export function WebSection(props: WebSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t }} />
}

function Loaded({ injected }: { injected: WebSectionFace }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  const disabled = !state.writable
  const names = new Map(state.rows.map(row => [row.entry.provider, row.entry.displayName]))
  const nameOf = (provider: string): string => names.get(provider) ?? provider

  const onSelect = async (value: string): Promise<void> => {
    setNotice(null)
    setProblem(null)
    const refused = await controller.select(value === '' ? undefined : value)
    if (refused === null) setNotice(t('selectionSaved'))
    else setProblem(refused)
    void controller.load()
  }

  const onKey = async (ref: string, provider: string, value: string): Promise<void> => {
    setNotice(null)
    setProblem(null)
    const refused = await controller.writeKey(ref, value)
    if (refused === null) setNotice(fill(t(value.length === 0 ? 'removedKey' : 'savedKey'), { provider }))
    else setProblem(refused)
    void controller.load()
  }

  const { failure, effective } = state.selection
  const selectionLine = failure !== undefined
    ? t(FAILURE_COPY[failure])
    : effective !== undefined
      ? fill(t('selectionEffective'), { provider: nameOf(effective) })
      : null

  return (
    <section className={styles['section']} aria-labelledby="web-settings-title">
      <h2 id="web-settings-title" className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('intro')}</p>
      {state.status === 'ready' && disabled ? <p className={styles['notice']}>{t('readOnly')}</p> : null}
      {state.status === 'error'
        ? <p className={styles['error']} role="alert">{t('loadFailed')}: {state.error}</p>
        : null}
      {state.credentialError !== null
        ? <p className={styles['notice']}>{fill(t('credentialsUnavailable'), { error: state.credentialError })}</p>
        : null}
      <label className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('selection')}</span>
        <select
          className={styles['input']}
          value={state.selection.configured ?? ''}
          disabled={disabled}
          aria-label={t('selection')}
          onChange={(event) => { void onSelect(event.target.value) }}
        >
          <option value="">{t('selectionAuto')}</option>
          {state.rows.map(row => (
            <option key={row.entry.provider} value={row.entry.provider}>{row.entry.displayName}</option>
          ))}
        </select>
      </label>
      {selectionLine !== null
        ? <p className={failure === undefined ? styles['savedNotice'] : styles['notice']} role="status">{selectionLine}</p>
        : null}
      {notice !== null ? <p className={styles['savedNotice']}>{notice}</p> : null}
      {problem !== null ? <p className={styles['error']} role="alert">{problem}</p> : null}
      <ul className={styles['rows']}>
        {state.rows.map(row => (
          <ProviderItem key={row.entry.provider} row={row} t={t} disabled={disabled} onKey={onKey} />
        ))}
      </ul>
    </section>
  )
}

function ProviderItem({ row, t, disabled, onKey }: {
  row: ProviderRow
  t: WebSectionInjected['t']
  disabled: boolean
  onKey: (ref: string, provider: string, value: string) => Promise<void>
}): ReactNode {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const name = row.entry.displayName
  const ref = row.apiKeyEnv
  // A key can be written only where the section names a reference and the
  // credential provider accepts writes; the document's own writability gates
  // nothing here, since the key never enters the document.
  const keyWritable = ref !== undefined && row.credential?.writable !== false && !disabled
  const usable = row.entry.available

  const submit = async (key: string, value: string): Promise<void> => {
    setBusy(true)
    await onKey(key, name, value)
    setDraft('')
    setBusy(false)
  }

  return (
    <li className={styles['row']}>
      <span className={styles['rowIdentity']}>
        <span className={styles['rowName']}>{name}</span>
        <span
          className={`${styles['dot']} ${usable ? styles['dotOn'] : styles['dotOff']}`}
          role="img"
          aria-label={usable ? t('available') : t('unavailable')}
          title={usable ? t('available') : t('unavailable')}
        />
        {row.credential !== undefined
          ? (
            <span
              className={`${styles['dot']} ${row.credential.configured ? styles['dotOn'] : styles['dotIdle']}`}
              role="img"
              aria-label={row.credential.configured ? t('credentialConfigured') : t('credentialMissing')}
              title={row.credential.configured ? t('credentialConfigured') : t('credentialMissing')}
            />
          )
          : null}
      </span>
      {row.entry.settingsNs === '' ? <p className={styles['caption']}>{t('noAddress')}</p> : null}
      {ref !== undefined
        ? (
          <form className={styles['keyForm']} onSubmit={(event) => { event.preventDefault(); void submit(ref, draft) }}>
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>{fill(t('keyLabel'), { provider: name })}</span>
              <input
                type="password"
                className={styles['input']}
                value={draft}
                disabled={!keyWritable || busy}
                placeholder={ref}
                autoComplete="off"
                onChange={(event) => { setDraft(event.target.value) }}
              />
            </label>
            <span className={styles['caption']}>{t('keyHint')}</span>
            <span className={styles['actions']}>
              <button type="submit" className={styles['button']} disabled={!keyWritable || busy || draft.length === 0}>
                {busy ? t('saving') : t('save')}
              </button>
              {row.credential?.configured === true
                ? (
                  <button type="button" className={styles['buttonQuiet']} disabled={!keyWritable || busy} onClick={() => { void submit(ref, '') }}>
                    {t('remove')}
                  </button>
                )
                : null}
            </span>
          </form>
        )
        : null}
    </li>
  )
}
