/**
 * The `sidebar.exit` occupant: the foot row below Settings and the
 * confirmation it opens (package-internal; the `./client` surface exposes only
 * the Loader exports). Same-package tests exercise it directly through this
 * module.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import clsx from 'clsx'
import { IconStopFill16, Modal } from '@arx-ai/arx-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@arx-ai/arx-client-ui-slots'
// Type-only: the SlotMap merge declaring `sidebar.exit`.
import type {} from '@arx-ai/arx-client-ui-sidebar/client'
import css from './ExitRow.module.css'

/** Injected face: the wire call the row drives (bound in apply's closure). */
export interface ExitRowInjected {
  /**
   * Ask the Host to stop the harness. Never rejects.
   * @returns false when the deployment refused, which it does when its
   * launcher provided no exit request; true otherwise. The answer arrives
   * before the process goes, because the connection carrying it dies with the
   * server — so a transport failure after the ask reports true as well, being
   * indistinguishable from a shutdown that raced its own response.
   */
  stop: () => Promise<boolean>
}

/** Full row props: the sidebar column state, the injected call, and locale. */
export type ExitRowProps = PropsRuntime<'sidebar.exit'> & ExitRowInjected & PropsLocale<'exit'>

/** What the row has asked for, which is all the state this occupant holds. */
type Phase = 'idle' | 'confirming' | 'stopping' | 'unavailable'

/**
 * Render the exit row and its confirmation.
 *
 * The confirmation is not ceremony: the control ends the server that serves
 * the page, so the viewer cannot undo it from the UI it is looking at. A
 * started shutdown never returns to idle — the page it lives on is going.
 * @param props - composed slot props.
 * @returns the foot row, plus the dialog while one is open.
 */
export function ExitRow({ wide, stop, t }: ExitRowProps): ReactElement {
  const [phase, setPhase] = useState<Phase>('idle')

  const confirm = (): void => {
    setPhase('stopping')
    void stop().then((started) => { if (!started) setPhase('unavailable') })
  }

  return (
    <>
      <button
        type="button"
        className={clsx(css.trigger, !wide && css.rail)}
        aria-haspopup="dialog"
        aria-expanded={phase === 'confirming'}
        disabled={phase === 'stopping'}
        onClick={() => { setPhase('confirming') }}
      >
        <IconStopFill16 size={wide ? 16 : 18} />
        {wide && (
          <span className={css.label}>{t(phase === 'stopping' ? 'stopping' : 'trigger')}</span>
        )}
      </button>
      <Modal
        open={phase === 'confirming' || phase === 'unavailable'}
        onClose={() => { setPhase('idle') }}
        title={t('confirm.title')}
        closeLabel={t('close')}
        description={phase === 'unavailable' ? t('unavailable') : t('confirm.description')}
        footer={phase === 'unavailable' ? undefined : (
          <>
            <button type="button" className={css.cancel} onClick={() => { setPhase('idle') }}>
              {t('confirm.cancel')}
            </button>
            <button type="button" className={css.stop} onClick={confirm}>
              {t('confirm.stop')}
            </button>
          </>
        )}
      />
    </>
  )
}
