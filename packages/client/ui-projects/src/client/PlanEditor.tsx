import { useEffect, useState, type ReactElement } from 'react'
import type { SavePlanRequest } from '@arx-ai/arx-api-remotes/client'
import type { PropsLocale } from '@arx-ai/arx-client-ui-slots'

type Item = SavePlanRequest['items'][number]
type PlanEditorProps = PropsLocale<'projects'> & {
  latest: (SavePlanRequest & { revision: number }) | undefined
  busy: boolean
  save: (request: SavePlanRequest) => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}
const createItem = (): Item => ({
  id: crypto.randomUUID() as Item['id'],
  title: '',
  acceptanceCriteria: [],
  dependsOn: [],
})

/** Edit tasks by stable identity, preserving dependencies when rows are removed. */
export function PlanEditor({ latest, busy, t, save, onDirtyChange }: PlanEditorProps): ReactElement {
  const [summary, setSummary] = useState(latest?.summary ?? '')
  const [items, setItems] = useState<readonly Item[]>(() => latest?.items ?? [createItem()])
  const dirty = JSON.stringify({ summary, items }) !== JSON.stringify({ summary: latest?.summary ?? '', items: latest?.items ?? [] })
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  const edit = (id: Item['id'], change: Partial<Item>): void => {
    setItems(current => current.map(item => (item.id === id ? { ...item, ...change } : item)))
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy)
          void save({
            summary: summary.trim(),
            items: items.map(item => ({
              ...item,
              title: item.title.trim(),
              acceptanceCriteria: item.acceptanceCriteria.map(criterion => criterion.trim()).filter(Boolean),
            })),
          })
      }}
    >
      <label>
        {t('summary')}
        <input
          required
          value={summary}
          onChange={(event) => {
            setSummary(event.currentTarget.value)
          }}
        />
      </label>
      {items.map((item, index) => (
        <fieldset key={item.id} disabled={busy}>
          <legend>
            {index + 1}. {item.title || t('items')}
          </legend>
          <label>
            {t('items')}
            <input
              required
              value={item.title}
              onChange={(event) => {
                edit(item.id, { title: event.currentTarget.value })
              }}
            />
          </label>
          <label>
            {t('criteria')}
            <textarea
              value={item.acceptanceCriteria.join('\n')}
              onChange={(event) => {
                edit(item.id, { acceptanceCriteria: event.currentTarget.value.split('\n') })
              }}
            />
          </label>
          <label>
            {t('dependencies')}
            <select
              multiple
              value={[...item.dependsOn]}
              onChange={(event) => {
                edit(item.id, {
                  dependsOn: Array.from(event.currentTarget.selectedOptions, option => option.value as Item['id']),
                })
              }}
            >
              {items
                .filter(other => other.id !== item.id)
                .map(other => (
                  <option key={other.id} value={other.id}>
                    {other.title || other.id}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setItems(current =>
                current
                  .filter(other => other.id !== item.id)
                  .map(other => ({
                    ...other,
                    dependsOn: other.dependsOn.filter(id => id !== item.id),
                  })),
              )
            }}
          >
            {t('removeTask')}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setItems(current => [...current, createItem()])
        }}
      >
        {t('addTask')}
      </button>
      <button disabled={busy || !summary.trim() || !items.length || items.some(item => !item.title.trim())}>
        {t('savePlan')}
      </button>
    </form>
  )
}
