/**
 * What every acknowledged onboarding notice shares: starting its store,
 * completing its step once, and the modal it shows until acknowledged.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@arx-ai/arx-client-ui-primitives'
import type { AcknowledgedNoticeState, AcknowledgedNoticeStore } from './notice-store.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import css from './AcknowledgedNotice.module.css'

/** The lifecycle half of an acknowledged notice step. */
export interface AcknowledgedNoticeLifecycle {
  /** Whether the notice has an unacknowledged answer to show. */
  pending: boolean
  /** Persist the acknowledgement, completing the step once it holds. */
  acknowledge: () => Promise<void>
}

/**
 * Start the notice's store, and complete its step at most once: when the
 * acknowledgement holds, or when the notice has nothing to announce.
 * @param controller - the notice's acknowledgement controller.
 * @param state - the controller's current state.
 * @param complete - the coordinator's completion callback for this step.
 * @param nothingToAnnounce - true once the notice knows it has no content,
 *   which completes the step without showing anything.
 * @returns whether the notice is pending, and the acknowledgement action.
 */
export function useAcknowledgedNotice(
  controller: AcknowledgedNoticeStore,
  state: AcknowledgedNoticeState,
  complete: () => void,
  nothingToAnnounce: boolean,
): AcknowledgedNoticeLifecycle {
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
    if (state.acknowledged || nothingToAnnounce) finish()
  }, [finish, nothingToAnnounce, state.acknowledged])

  const acknowledge = useCallback(async (): Promise<void> => {
    if (await controller.acknowledge()) finish()
  }, [controller, finish])

  return {
    pending: state.status !== 'idle' && state.status !== 'loading' && !state.acknowledged,
    acknowledge,
  }
}

/** Props of {@link AcknowledgedNoticeModal}. */
export interface AcknowledgedNoticeModalProps {
  /** Dialog title, which is also its accessible name. */
  title: string
  /** Body copy, one entry per paragraph. */
  paragraphs: readonly string[]
  /** Alert text after a failed acknowledgement, or null when none failed. */
  error: string | null
  /** Label of the button that acknowledges. */
  continueLabel: string
  /** Whether an acknowledgement is being saved; the button waits for it. */
  saving: boolean
  /** Acknowledge the notice. */
  onContinue: () => void
}

/**
 * The modal an acknowledged notice shows until the user continues past it.
 * @param props - copy, failure, and the acknowledgement action.
 * @returns the onboarding modal.
 */
export function AcknowledgedNoticeModal(props: AcknowledgedNoticeModalProps): ReactNode {
  return (
    <OnboardingModal title={props.title}>
      <div className={css.copy}>
        {props.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      </div>
      {props.error === null ? null : <p className={css.error} role="alert">{props.error}</p>}
      <div className={css.actions}>
        <Button variant="primary" className={css.primary} disabled={props.saving} onClick={props.onContinue}>
          {props.continueLabel}
        </Button>
      </div>
    </OnboardingModal>
  )
}
