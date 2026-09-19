/** Read-only full-session index; navigation and history remain conversation-owned. */
import { useEffect, useRef, useState } from 'react'
import type { ConvViewProps } from '@arx-ai/arx-client-ui-conversation/client'
import type { PropsLocale } from '@arx-ai/arx-client-ui-slots'
import type {} from '@arx-ai/arx-session-turn-outline/client'
import type { TurnOutlinePage } from '@arx-ai/arx-session-turn-outline/client'
import type { OutlineKey } from './locales.ts'
import css from './TurnOutline.module.css'

const STATUS_KEYS = new Set<OutlineKey>(['running', 'completed', 'aborted', 'blocked', 'error', 'interrupted', 'max-tokens'])

/** Authenticated bounded page callback supplied by the registration. */
export interface OutlineInjected { readPage: (before: number | null, query: string) => Promise<TurnOutlinePage> }
/** Render a searchable outline with a truthful navigation failure state. */
export function TurnOutline({ useProjection, revealTurn, cancelRevealTurn, sessionId, readPage, t }: ConvViewProps & PropsLocale<'turnOutline'> & OutlineInjected) {
  const outline = useProjection('turnOutline')
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<number | null>(null)
  const [loaded, setLoaded] = useState<{ key: string; page: TurnOutlinePage } | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const requestKey = JSON.stringify([sessionId, cursor, query])
  const remotePage = query !== '' || cursor !== null
  const shown = remotePage ? loaded?.key === requestKey ? loaded.page : undefined : outline
  useEffect(() => {
    let current = true
    setPageError(null)
    if (!remotePage) return
    void readPage(cursor, query).then((page) => { if (current) setLoaded({ key: requestKey, page }) }, () => {
      if (current) setPageError(requestKey)
    })
    return () => { current = false }
  }, [cursor, query, sessionId, remotePage, requestKey, readPage])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)
  const navigating = useRef(false)
  useEffect(() => {
    navigating.current = false; setBusy(false); setFailed(false)
    return () => { generation.current += 1; cancelRevealTurn?.() }
  }, [sessionId, cancelRevealTurn])
  const open = async (startSeq: number, navigate: NonNullable<ConvViewProps['revealTurn']>): Promise<void> => {
    if (navigating.current) return
    navigating.current = true
    const request = ++generation.current
    setBusy(true)
    setFailed(false)
    try {
      const opened = await navigate(startSeq)
      if (generation.current === request) setFailed(!opened)
    } catch {
      if (generation.current === request) setFailed(true)
    } finally {
      if (generation.current === request) { navigating.current = false; setBusy(false) }
    }
  }
  if (outline === undefined) return <p role="status">{t('unavailable')}</p>
  const turns = shown?.turns ?? []
  return <section className={css.outline} aria-label={t('title')}>
    <label>{t('search')}<input value={query} maxLength={200} onChange={(event) => { setQuery(event.target.value); setCursor(null) }} /></label>
    <p>{t('total', { total: outline.total })}</p>
    <button type="button" disabled={cursor === null} onClick={() => { setCursor(null) }}>{t('newest')}</button>
    <button type="button" disabled={!shown?.hasMore} onClick={() => { setCursor(shown?.nextBefore ?? null) }}>{t('older')}</button>
    {remotePage && shown === undefined && pageError !== requestKey && <p role="status">{t('loadingPage')}</p>}
    {pageError === requestKey && <p role="alert">{t('failedPage')}</p>}
    {busy && <p role="status">{t('loading')}</p>}
    {failed && <p role="alert">{t('failed')}</p>}
    {shown !== undefined && turns.length === 0 && <p>{t('empty')}</p>}
    <ol className={css.turns}>{turns.map(turn => <li key={turn.startSeq}>
      <button type="button" disabled={busy || revealTurn === undefined} title={t('open')}
        onClick={revealTurn === undefined ? undefined : () => { void open(turn.startSeq, revealTurn) }}>
        <strong>{t('turn', { turn: turn.turn })}</strong>
        <span>{turn.preview || t('untitled')}</span>
        <small>{STATUS_KEYS.has(turn.status as OutlineKey) ? t(turn.status as OutlineKey) : turn.status}</small>
      </button>
    </li>)}</ol>
  </section>
}
