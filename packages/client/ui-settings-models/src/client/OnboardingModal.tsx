/** Shared modal chrome for every step registered by this onboarding plugin. */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Modal } from '@arx-ai/arx-client-ui-primitives'
import css from './OnboardingModal.module.css'

const ignoreImplicitDismiss = (): void => {}

/**
 * Render a blocking onboarding dialog and keep the application root inert.
 * The title takes focus on mount, since a step's body carries no control a
 * screen reader should land on ahead of the heading that names the step.
 * @param props.title - accessible and visible dialog title.
 * @param props.children - step-owned body and actions.
 * @returns the body-portaled modal.
 */
export function OnboardingModal({ title, children }: {
  title: string
  children: ReactNode
}): ReactNode {
  const titleRef = useRef<HTMLHeadingElement | null>(null)

  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [])

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  return (
    <Modal
      open
      title={title}
      onClose={ignoreImplicitDismiss}
      headless
      className={css.dialog as string}
    >
      <div className={css.content}>
        <h2 ref={titleRef} className={css.title} tabIndex={-1}>{title}</h2>
        <div className={css.body}>{children}</div>
      </div>
    </Modal>
  )
}
