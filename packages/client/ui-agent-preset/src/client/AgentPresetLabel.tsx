/**
 * The session header's agent-preset switch.
 *
 * The button names the preset this session runs and opens the roster with that
 * preset marked. A session's composition is fixed once its conversation
 * starts: the host refuses to recompose it. Picking another preset from a
 * started session therefore opens a new session in the same workspace under
 * that preset and leaves this one as it is, and the menu says so on those rows
 * before the click. A blank session switches in place through the select the
 * new-session chip ({@link AgentPresetSeat}) uses. Picking the running preset
 * does nothing.
 */

import { useEffect, useState } from 'react'
import type { SessionId, SnapshotStore } from '@arx-ai/arx-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@arx-ai/arx-client-ui-slots'
import { IconAgentPresetOutline16, IconChevronDownOutline14, Menu } from '@arx-ai/arx-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the header actions).
import type {} from '@arx-ai/arx-client-ui-conversation/client'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText } from './locales.ts'
import { presetMenuItems } from './PresetMenuItem.tsx'
import css from './AgentPresetLabel.module.css'

/** Registration-side business face for the header switch. */
export interface AgentPresetLabelInjected {
  hooks: {
    /** Roster snapshot bound by the renderer as useAgentPresets. */
    agentPresets: SnapshotStore<AgentPresetSettingsState>
  }
  /** Read the roster, so the switch can show names rather than ids. */
  load: () => Promise<void>
  /**
   * Run a preset picked from one session's header: in place for a blank
   * session, in a new session of the same workspace for a started one, and
   * not at all for the preset the session already runs.
   * @param sessionId - the session whose header the pick came from.
   * @param id - the picked preset.
   */
  choose: (sessionId: SessionId, id: string) => void
}

/** Full component props. */
export type AgentPresetLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetLabelInjected>

/**
 * Render this session's agent-preset switch beside its title.
 * @param props - composed slot props.
 * @returns the switch, or null when the session records no preset.
 */
export function AgentPresetLabel({
  sessionId, useSessions, useAgentPresets, load, choose, t,
}: AgentPresetLabelProps) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const started = useSessions(state => state.byId[sessionId]?.blank === false)
  const options = useAgentPresets(state => state.options)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // Deployments that compose no presets never label anything, so the roster
    // is only worth a request once a session reports one.
    if (preset !== undefined) void load()
  }, [preset, load])

  if (preset === undefined) return null

  const option = options.find(entry => entry.id === preset)
  const text = option === undefined ? undefined : presetDisplayText(option, t)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={presetMenuItems(options, t, entry => (
        started && entry.id !== preset ? t('headerNewSession') : undefined
      ))}
      selectedId={preset}
      onSelect={(id) => {
        setOpen(false)
        choose(sessionId, id)
      }}
      align="start"
      portal
      anchor={(
        <button
          type="button"
          className={css.label}
          aria-haspopup="menu"
          aria-expanded={open}
          title={text?.description ?? t('headerHint')}
          // Until the roster answers there is nothing to choose between.
          disabled={options.length === 0}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconAgentPresetOutline16 size={14} className={css.icon} />
          <span className={css.name}>{text?.name ?? preset}</span>
          <IconChevronDownOutline14 size={12} className={css.chevron} />
        </button>
      )}
    />
  )
}
