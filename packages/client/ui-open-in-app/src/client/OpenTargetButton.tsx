/** Split button opening one directory: a default application action, an application menu, and per-gesture failure feedback. */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevronDownOutline14, IconRightUpOutline16, Menu, Tooltip } from '@arx-ai/arx-client-ui-primitives'
import type { TranslateNS } from '@arx-ai/arx-client-ui-slots'
import { useOpenFailureToast } from './open-failure-toast.tsx'
import type { NS } from './locales.ts'
import css from './OpenTargetButton.module.css'

/** One application the button can open the directory in. */
export interface OpenTargetApplication {
  readonly id: string
  /** Localized product name. */
  readonly name: string
  /** Image data URL, or null for the generic glyph. */
  readonly icon: string | null
}

/** Inputs of the split button. */
export interface OpenTargetButtonProps {
  /** Applications in host menu order. */
  readonly applications: readonly OpenTargetApplication[]
  /** The application the main half opens, one of `applications`. */
  readonly preferred: OpenTargetApplication
  readonly t: TranslateNS<typeof NS>
  /**
   * Open the directory in one application.
   * @param appId - the application.
   * @param picked - true when the id came from the menu rather than the main half.
   * @returns true when the launch was counted; false announces the failure. Never rejects.
   */
  readonly execute: (appId: string, picked: boolean) => Promise<boolean>
}

/** One application image with a per-image fallback to the generic glyph. */
function ApplicationIcon({ source, size = 14 }: { source: string | null; size?: number }): ReactNode {
  const [failed, setFailed] = useState(false)
  return source === null || failed
    ? <IconRightUpOutline16 size={size} />
    : <img src={source} width={size} height={size} className={css.appIcon} alt="" draggable={false} onError={() => { setFailed(true) }} />
}

/**
 * Render the split button: the main half opens the default application, the
 * chevron lists every application with the default marked. One gesture runs
 * at a time; a failed launch announces through the button's own toast.
 * @param props - applications, the default, and the launch operation.
 * @returns the control and its transient failure feedback.
 */
export function OpenTargetButton({ applications, preferred, t, execute }: OpenTargetButtonProps): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false)
  // A discrete click re-renders before the next event is dispatched, so the
  // disabled halves are what keeps one gesture in flight at a time.
  const [pending, setPending] = useState(false)
  const { toast, show } = useOpenFailureToast()
  const hasMenu = applications.length > 1
  const primaryLabel = t('open.title', { app: preferred.name })
  const act = (appId: string, picked: boolean): void => {
    setMenuOpen(false)
    setPending(true)
    void execute(appId, picked).then((launched) => {
      if (!launched) show(t('open.error'))
      setPending(false)
    })
  }
  return (
    <>
      <Menu
        open={menuOpen && !pending && hasMenu}
        portal
        dense
        align="end"
        onClose={() => { setMenuOpen(false) }}
        items={applications.map(app => ({
          id: app.id,
          icon: <ApplicationIcon key={app.icon} source={app.icon} />,
          label: app.id === preferred.id ? t('open.default', { app: app.name }) : app.name,
        }))}
        onSelect={(id) => { act(id, true) }}
        anchor={(
          <div className={css.split} data-open-in-app data-state={pending ? 'busy' : 'idle'}>
            <Tooltip label={primaryLabel} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.main}
                disabled={pending}
                aria-label={primaryLabel}
                onClick={() => { act(preferred.id, false) }}
              >
                <ApplicationIcon key={preferred.icon} source={preferred.icon} size={13} />
              </button>
            </Tooltip>
            {hasMenu && (
              <button
                type="button"
                className={css.chevron}
                disabled={pending}
                aria-haspopup="menu"
                aria-expanded={menuOpen && !pending}
                aria-label={t('open.more')}
                onClick={() => { setMenuOpen(value => !value) }}
              >
                <IconChevronDownOutline14 size={10} />
              </button>
            )}
          </div>
        )}
      />
      {toast}
    </>
  )
}
