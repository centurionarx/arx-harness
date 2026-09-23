/**
 * First-run guide for an installation with no model provider it can use. It
 * reads the same provider join as the Models page, lists what that page can
 * add without naming any provider itself, and opens the page.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@arx-ai/arx-client-ui-primitives'
import type { SnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@arx-ai/arx-client-ui-slots'
import { useAcknowledgedNotice } from './AcknowledgedNotice.tsx'
import type { AcknowledgedNoticeState, AcknowledgedNoticeStore } from './notice-store.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import { providerOffer, providerUsable } from './store.ts'
import type { ModelsSettingsState, ModelsSettingsStore, ProviderOffer } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { en } from './locales.ts'
import css from './AcknowledgedNotice.module.css'

/** Registration-side dependencies of {@link ProviderGuide}. */
export interface ProviderGuideInjected {
  hooks: {
    /** Durable or process-local dismissal state. */
    providerGuide: SnapshotStore<AcknowledgedNoticeState>
    /** The provider join the Models page renders. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Guide dismissal controller. */
  controller: AcknowledgedNoticeStore
  /** The Models page controller, loaded here only for a guide not yet dismissed. */
  models: ModelsSettingsStore
  /** Settings schema operations, for the protocols a declared route may speak. */
  schema: SettingsSchemaOperations
  /** Onboarding copy. */
  t: (key: keyof typeof en) => string
}

/** Coordinator owner props plus this step's injected face. */
export type ProviderGuideProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<ProviderGuideInjected>

/**
 * The guide's list, one line per kind of provider the directory offers.
 * @param offer - what the directory can add.
 * @param t - onboarding copy.
 * @returns the lines, empty when the directory offers nothing.
 */
function offerLines(offer: ProviderOffer, t: ProviderGuideInjected['t']): string[] {
  const lines: string[] = []
  if (offer.hosted === 1) lines.push(t('providerGuideHostedOne'))
  else if (offer.hosted > 1) lines.push(t('providerGuideHosted').replaceAll('{count}', String(offer.hosted)))
  if (offer.compatible) lines.push(t('providerGuideCompatible'))
  for (const name of offer.commandLine) lines.push(t('providerGuideCommandLine').replaceAll('{name}', name))
  return lines
}

/**
 * Show the guide while no provider can serve a request and the user has not
 * dismissed this version of it. A provider becoming usable, or a join that
 * cannot answer, completes the step without showing anything.
 * @param props - settings-shell owner state and this step's dependencies.
 * @returns the guide modal, or null while the step decides not to show.
 */
export function ProviderGuide(props: ProviderGuideProps): ReactNode {
  const { complete, openSection, controller, models, schema, useProviderGuide, useModels, t } = props
  const state = useProviderGuide(snapshot => snapshot)
  const directory = useModels(snapshot => snapshot)
  // Only a guide not yet dismissed needs the provider join, so an
  // installation past it never reads the directory at startup for it.
  const undismissed = state.status !== 'idle' && state.status !== 'loading' && !state.acknowledged
  useEffect(() => {
    if (undismissed && directory.status === 'idle') void models.load()
  }, [directory.status, models, undismissed])
  // A refresh keeps the rows it replaces, so the guide answers from those
  // rather than disappearing while the page reloads.
  const answered = directory.status === 'ready' || (directory.status === 'loading' && directory.rows.length > 0)
  const nothingToAnnounce = directory.status === 'error' || (answered && directory.rows.some(providerUsable))
  const { pending, dismiss } = useAcknowledgedNotice(controller, state, complete, nothingToAnnounce)

  if (!pending || !answered || nothingToAnnounce) return null

  const lines = offerLines(providerOffer(directory, schema), t)
  return (
    <OnboardingModal title={t('providerGuideTitle')}>
      <div className={css.copy}>
        <p>{t('providerGuideBody')}</p>
        {lines.length === 0 ? null : <p>{t('providerGuideOffersLead')}</p>}
      </div>
      {lines.length === 0 ? null : <ul className={css.offers}>{lines.map(line => <li key={line}>{line}</li>)}</ul>}
      <div className={css.actions}>
        <Button variant="outline" className={css.secondary} onClick={dismiss}>
          {t('providerGuideLater')}
        </Button>
        <Button
          variant="primary"
          className={css.primary}
          onClick={() => {
            dismiss()
            openSection('models')
          }}
        >
          {t('providerGuideOpen')}
        </Button>
      </div>
    </OnboardingModal>
  )
}
