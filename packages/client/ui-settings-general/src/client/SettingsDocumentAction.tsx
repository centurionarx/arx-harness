/** Optional settings-header action for opening a file-backed Host document. */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@arx-ai/arx-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@arx-ai/arx-client-ui-slots'
import type { SettingsDocumentStore } from './settings-document-store.ts'
import css from './SettingsDocumentAction.module.css'

/** Registrant-owned dependencies of {@link SettingsDocumentAction}. */
export interface SettingsDocumentActionInjected {
  /** Provider metadata and action state owner. */
  controller: SettingsDocumentStore
  hooks: {
    /** Controller snapshot bound by the UI renderer as useSnapshot. */
    snapshot: SettingsDocumentStore['store']
  }
}

/** Header-action owner share, localized copy, and the registrant's state face. */
export type SettingsDocumentActionProps =
  PropsRuntime<'settings.action'> & PropsLocale<'settings'> & InjectFace<SettingsDocumentActionInjected>

/**
 * Render the open-document action only after Host metadata confirms document
 * availability. When the Host names no desktop opener (a headless
 * deployment), the same availability renders the document path with a copy
 * action instead of an open gesture that could never reach a desktop.
 * @param props - header owner props, localized copy, and injected document state.
 * @returns the action, or null while unavailable or unresolved.
 */
export function SettingsDocumentAction({ controller, useSnapshot, t }: SettingsDocumentActionProps): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void controller.load()
  }, [controller])

  if (state.status !== 'ready') return null

  if (!state.canOpen) {
    const copy = () => {
      void navigator.clipboard?.writeText(state.documentPath).then(() => { setCopied(true) }).catch(() => {})
    }
    return (
      <div className={css.action}>
        <span className={css.location} title={state.documentPath}>{state.documentPath}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setCopied(false)
            copy()
          }}
        >
          {copied ? t('openDocument.copied') : t('openDocument.copy')}
        </Button>
      </div>
    )
  }

  return (
    <div className={css.action}>
      {state.error === null ? null : <span className={css.error} role="alert">{t('openDocument.error')}</span>}
      <Button
        variant="outline"
        size="sm"
        disabled={state.opening}
        onClick={() => { void controller.open() }}
      >
        {t('openDocument')}
      </Button>
    </div>
  )
}
