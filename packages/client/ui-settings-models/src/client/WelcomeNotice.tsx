/** Product-wide, versioned internal-testing notice. */

import type { ReactNode } from 'react'
import type { SnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@arx-ai/arx-client-ui-slots'
import { AcknowledgedNoticeModal, useAcknowledgedNotice } from './AcknowledgedNotice.tsx'
import type { AcknowledgedNoticeState, AcknowledgedNoticeStore } from './notice-store.ts'
import type { en } from './locales.ts'

/** Registration-side dependencies of {@link WelcomeNotice}. */
export interface WelcomeNoticeInjected {
  hooks: {
    /** Durable or process-local acknowledgement state. */
    welcome: SnapshotStore<AcknowledgedNoticeState>
  }
  /** Welcome acknowledgement controller. */
  controller: AcknowledgedNoticeStore
  /** Onboarding copy. */
  t: (key: keyof typeof en) => string
}

/** Coordinator owner props plus this step's injected face. */
export type WelcomeNoticeProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<WelcomeNoticeInjected>

/**
 * Render the current notice until its exact copy version is acknowledged.
 * @param props - settings-shell owner state and welcome dependencies.
 * @returns the welcome modal or null while the step decides not to show.
 */
export function WelcomeNotice(props: WelcomeNoticeProps): ReactNode {
  const { complete, controller, useWelcome, t } = props
  const state = useWelcome(snapshot => snapshot)
  const { pending, acknowledge } = useAcknowledgedNotice(controller, state, complete, false)

  if (!pending) return null

  return (
    <AcknowledgedNoticeModal
      title={t('welcomeTitle')}
      paragraphs={t('welcomeBody').split('\n\n')}
      error={state.error === null ? null : t('welcomeError')}
      continueLabel={t('welcomeContinue')}
      saving={state.status === 'saving'}
      onContinue={() => { void acknowledge() }}
    />
  )
}
