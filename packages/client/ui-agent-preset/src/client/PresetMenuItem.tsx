/**
 * The preset rows the new-session chip and the session-header switch share:
 * each preset's name over what it is for, and, where the surface needs one, a
 * line saying what picking it does.
 */

import type { MenuItem } from '@arx-ai/arx-client-ui-primitives'
import type { AgentPresetOption } from './settings-store.ts'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'
import css from './PresetMenuItem.module.css'

/**
 * Build one menu row per preset.
 * @param options - presets to offer, in roster order.
 * @param t - active Web locale lookup.
 * @param note - the consequence line for one row, or undefined for none.
 * @returns the rows, keyed by preset id.
 */
export function presetMenuItems(
  options: readonly AgentPresetOption[],
  t: (key: AgentPresetSettingsKey) => string,
  note: (option: AgentPresetOption) => string | undefined = () => undefined,
): MenuItem[] {
  return options.map((option) => {
    const text = presetDisplayText(option, t)
    const consequence = note(option)
    return {
      id: option.id,
      // Name and description together: the id alone never says what a
      // preset does, which is why the roster carries display copy.
      label: (
        <span className={css.item}>
          <span className={css.itemName}>{text.name}</span>
          <span className={css.itemDesc}>{text.description ?? t('noDescription')}</span>
          {consequence === undefined ? null : <span className={css.itemNote}>{consequence}</span>}
        </span>
      ),
    }
  })
}
