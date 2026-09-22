/** One-time notice that this installation copied a pre-rename harness home. */

import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { HostDescriptionSource } from '@arx-ai/arx-client-connection/client'
import type { SnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@arx-ai/arx-client-ui-slots'
import { Button } from '@arx-ai/arx-client-ui-primitives'
import type { AcknowledgedNoticeState, AcknowledgedNoticeStore } from './notice-store.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import css from './WelcomeNotice.module.css'

/** Registration-side dependencies of {@link HomeMigrationNotice}. */
export interface HomeMigrationNoticeInjected {
  hooks: {
    /** Durable or process-local acknowledgement state. */
    homeMigrationNotice: SnapshotStore<AcknowledgedNoticeState>
    /** Generation-scoped Host facts carrying the copy this installation made. */
    hostDescription: HostDescriptionSource
  }
  /** Home-migration acknowledgement controller. */
  controller: AcknowledgedNoticeStore
  /** Onboarding copy. */
  t: (key: keyof typeof en) => string
}

/** Coordinator owner props plus this step's injected face. */
export type HomeMigrationNoticeProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<HomeMigrationNoticeInjected>

/**
 * Render the notice until the user acknowledges the copy this installation
 * made. A Host that reports no copy — every installation but the first launch
 * after an upgrade — completes the step without showing anything.
 * @param props - settings-shell owner state and this step's dependencies.
 * @returns the notice modal, or null while the step decides not to show.
 */
export function HomeMigrationNotice(props: HomeMigrationNoticeProps): ReactNode {
  const { complete, controller, useHomeMigrationNotice, useHostDescription, t } = props
  const state = useHomeMigrationNotice(snapshot => snapshot)
  // Absence of a description is not absence of a copy: the source reports none
  // while reconnecting, and completing on that would retire this step without
  // the user ever seeing it. Only a description that arrived and carries no
  // copy settles the question.
  const described = useHostDescription(description => description !== undefined)
  const migration = useHostDescription(description => description?.homeMigration)
  const finished = useRef(false)
  const finish = useCallback((): void => {
    if (finished.current) return
    finished.current = true
    complete()
  }, [complete])

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (state.acknowledged || (described && migration === undefined)) finish()
  }, [described, finish, migration, state.acknowledged])

  if (migration === undefined) return null
  if (state.status === 'idle' || state.status === 'loading' || state.acknowledged) return null

  const acknowledge = async (): Promise<void> => {
    if (await controller.acknowledge()) finish()
  }
  const paragraphs = t('homeMigrationBody')
    .replaceAll('{from}', migration.fromDisplay)
    .replaceAll('{to}', migration.toDisplay)
    .split('\n\n')

  return (
    <OnboardingModal title={t('homeMigrationTitle')}>
      <div className={css.copy}>
        {paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      </div>
      {state.error === null ? null : <p className={css.error} role="alert">{t('welcomeError')}</p>}
      <div className={css.actions}>
        <Button
          variant="primary"
          className={css.primary}
          disabled={state.status === 'saving'}
          onClick={() => { void acknowledge() }}
        >
          {t('homeMigrationContinue')}
        </Button>
      </div>
    </OnboardingModal>
  )
}
