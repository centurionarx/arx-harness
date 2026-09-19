import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot } from '@arx-ai/arx-api-remotes/client'
import { IconChevronDownOutline14, IconSearchOutline16 } from '@arx-ai/arx-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@arx-ai/arx-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

export interface PluginInventorySettingsTabInjected {
  list: () => Promise<PluginInventorySnapshot>
}

export type PluginInventorySettingsTabProps = PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type PluginEntry = PluginInventorySnapshot['entries'][number]
type Preset = NonNullable<PluginInventorySnapshot['agentPresets']>[number]
type FiberPhase = PluginEntry['fiberPhase']
type Enablement = boolean | 'conditional'
interface CatalogEntry {
  key: string
  entryId: string | null
  moduleName: string
  enabled: Enablement
  fiberPhase: FiberPhase
  condition?: string
}
type ViewState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending', loading: 'loadingPhase', active: 'active', failed: 'failed', unloading: 'unloading',
} satisfies Record<Exclude<FiberPhase, null>, PluginInventoryLocaleKey>

function phaseLabel(phase: FiberPhase, t: PluginInventorySettingsTabProps['t']): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped.replace(/^cordis:/, '').replace(/^cordis-plugin-/, '').replace(/^arx-(?:host-|client-)?/, '')
}

function matches(entry: CatalogEntry, query: string): boolean {
  if (query.length === 0) return true
  return [entry.moduleName, entry.entryId ?? ''].some(value => value.toLocaleLowerCase().includes(query))
}

function normalizeGlobal(entries: readonly PluginEntry[]): CatalogEntry[] {
  return entries.map(entry => ({ ...entry, key: `global:${entry.entryId}` }))
}

function normalizePreset(preset: Preset): CatalogEntry[] {
  return preset.rows.map((row, index) => ({ ...row, key: `preset:${preset.id}:${String(index)}` }))
}

function enablementLabel(enabled: Enablement, t: PluginInventorySettingsTabProps['t']): string {
  return t(enabled === 'conditional' ? 'conditionalTag' : enabled ? 'enabledTag' : 'disabledTag')
}

/** Global Loader entries and config-free per-preset compositions. */
export function PluginInventorySettingsTab({ list, t }: PluginInventorySettingsTabProps): ReactNode {
  const catalogId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('global')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const presets = state.status === 'ready' ? state.snapshot.agentPresets ?? [] : []
  const selectedPreset = presets.find(preset => preset.id === scope)
  const entries = useMemo(() => {
    if (state.status !== 'ready') return []
    return selectedPreset === undefined ? normalizeGlobal(state.snapshot.entries) : normalizePreset(selectedPreset)
  }, [selectedPreset, state])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredEntries = useMemo(() => entries.filter(entry => matches(entry, normalizedQuery)), [entries, normalizedQuery])

  useEffect(() => {
    if (scope !== 'global' && !presets.some(preset => preset.id === scope)) setScope('global')
  }, [presets, scope])
  useEffect(() => {
    if (expanded !== null && !filteredEntries.some(entry => entry.key === expanded)) setExpanded(null)
  }, [expanded, filteredEntries])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? <div className={css.failure}><p role="alert">{t('error')}</p><button type="button" onClick={retry}>{t('retry')}</button></div> : null}
      {state.status === 'ready' ? (
        <div className={css.catalog}>
          {presets.length > 0 ? (
            <label className={css.scopePicker}>
              <span>{t('scope')}</span>
              <select value={scope} onChange={(event) => { setScope(event.currentTarget.value); setQuery('') }}>
                <option value="global">{t('globalScope')}</option>
                {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name ?? preset.id}</option>)}
              </select>
            </label>
          ) : null}
          <label className={css.search}>
            <IconSearchOutline16 aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input type="search" value={query} placeholder={t('search')} aria-label={t('search')} onChange={(event) => { setQuery(event.currentTarget.value) }} />
          </label>
          <div className={css.catalogHeading}>
            <h3>{selectedPreset === undefined ? t('catalog') : selectedPreset.name ?? selectedPreset.id}</h3>
            <span data-plugin-count={filteredEntries.length}>{filteredEntries.length}</span>
          </div>
          {selectedPreset !== undefined ? (
            <p className={css.presetMeta}>
              {t(selectedPreset.trust === 'system' ? 'systemPreset' : 'userPreset')}
              {selectedPreset.isDefault ? ` · ${t('defaultPreset')}` : ''}
            </p>
          ) : null}
          {selectedPreset?.broken !== undefined ? <p className={css.failure} role="alert">{t('brokenPreset')}</p> : null}
          {entries.length === 0 && selectedPreset?.broken === undefined ? <p className={css.status}>{t('empty')}</p> : null}
          {entries.length > 0 && filteredEntries.length === 0 ? <p className={css.status}>{t('emptySearch')}</p> : null}
          {filteredEntries.length > 0 ? (
            <ul className={css.cards}>
              {filteredEntries.map((entry) => {
                const title = moduleShortName(entry.moduleName)
                const status = phaseLabel(entry.fiberPhase, t)
                const configuration = enablementLabel(entry.enabled, t)
                const open = expanded === entry.key
                const detailId = `${catalogId}-details-${encodeURIComponent(entry.key)}`
                const observed = entry.enabled === true
                return (
                  <li className={css.card} key={entry.key} data-plugin-entry={entry.entryId ?? undefined} data-open={open ? 'true' : undefined}>
                    <button className={css.cardContent} type="button" aria-expanded={open} aria-controls={detailId} aria-label={observed ? `${title}, ${status}, ${configuration}` : `${title}, ${configuration}`} onClick={() => { setExpanded(value => value === entry.key ? null : entry.key) }}>
                      <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
                      <span className={css.cardTrailing}>
                        {observed ? <span className={css.statusDot} data-phase={entry.fiberPhase ?? 'unobserved'} role="img" aria-label={status} title={status} /> : null}
                        <span className={css.configTag} data-enabled={String(entry.enabled)}>{configuration}</span>
                        <IconChevronDownOutline14 className={css.chevron} size={12} aria-hidden="true" />
                      </span>
                    </button>
                    {open ? (
                      <div className={css.cardDetails} id={detailId}>
                        {entry.entryId === null ? null : <code className={css.entryValue} data-loader-entry>{entry.entryId}</code>}
                        <dl className={css.details}>
                          <div><dt>{t('configuration')}</dt><dd>{configuration}</dd></div>
                          {observed ? <div><dt>{t('cordis')}</dt><dd>{status}</dd></div> : null}
                          {entry.condition === undefined ? null : <div><dt>{t('condition')}</dt><dd>{entry.condition}</dd></div>}
                        </dl>
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
