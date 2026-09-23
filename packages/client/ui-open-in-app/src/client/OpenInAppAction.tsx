/** Session-header entry adapting the host's application list to the split button. */
import type { ObservableSnapshot } from '@arx-ai/arx-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@arx-ai/arx-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the header utilities).
import type {} from '@arx-ai/arx-client-ui-conversation/client'
import { appKey, type NS } from './locales.ts'
import { OpenTargetButton } from './OpenTargetButton.tsx'

/** Browser operations and state injected into the session-header entry. */
export interface OpenInAppActionInjected {
  hooks: {
    /** Resolved application ids in host menu order; null until the host answered. */
    openInAppApps: ObservableSnapshot<readonly string[] | null>
    /** Icon data URLs by application id. */
    openInAppIcons: ObservableSnapshot<Readonly<Record<string, string>>>
    /** Last chosen application id, or empty. */
    openInAppChoice: ObservableSnapshot<string>
  }
  /**
   * Launch one application on a workspace directory.
   * @param appId - catalog id.
   * @param path - the session's workspace directory.
   * @returns after the host counted the launch; rejects on any failure.
   */
  launch: (appId: string, path: string) => Promise<void>
  /**
   * Remember one picked application as the default.
   * @param appId - catalog id.
   */
  choose: (appId: string) => void
}

/** Full props for the session-header open-in-app entry. */
export type OpenInAppActionProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<OpenInAppActionInjected>

/**
 * Render the split button for the session's workspace directory. Only ids the
 * dictionary names are offered, so a host catalog extension without copy
 * stays invisible instead of showing a raw id; the remembered choice is the
 * default when the host still offers it, otherwise the first application.
 * @param props - composed slot props.
 * @returns the split button, or null without a workspace directory or an application.
 */
export function OpenInAppAction(props: OpenInAppActionProps): React.JSX.Element | null {
  const { sessionId, useSessions, useOpenInAppApps, useOpenInAppIcons, useOpenInAppChoice, launch, choose, t } = props
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const available = useOpenInAppApps(apps => apps)
  const icons = useOpenInAppIcons(byId => byId)
  const choice = useOpenInAppChoice(id => id)
  const applications = (available ?? []).flatMap((id) => {
    const key = appKey(id)
    return key === undefined ? [] : [{ id, name: t(key), icon: icons[id] ?? null }]
  })
  const preferred = applications.find(app => app.id === choice) ?? applications[0]
  if (preferred === undefined || cwd === undefined || cwd === '') return null
  return (
    <OpenTargetButton
      key={cwd}
      applications={applications}
      preferred={preferred}
      t={t}
      execute={async (appId, picked) => {
        try {
          await launch(appId, cwd)
        } catch {
          // Swallows the launch rejection: the button announces the failure
          // from its own toast, and the host's message carries nothing the
          // copy does not already say.
          return false
        }
        if (picked) choose(appId)
        return true
      }}
    />
  )
}
