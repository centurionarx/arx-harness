// Session stats under the composer, split into two icon pills: a gauge pill
// (turn/step counts + output speed) opening the time-and-speed dialog, and a
// database pill (total tokens + cache hit) opening the token-usage dialog.
// Settled-node identity prevents stream-delta updates from rerendering the row.
// Mounted on 'conversation.composer.dock' so it sticks with the composer in the
// active conversation scrollport (see ConversationRoot data-conversation-scroll).

import { memo, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconDatabaseOutline16, IconGaugeOutline16 } from '@arx-ai/arx-client-ui-primitives'
import type { ConversationSnapshot, UseProjection } from '@arx-ai/arx-client-runtime/client'
import type { SnapshotSelectorHook } from '@arx-ai/arx-client-ui-slots'
// Type-only: merges the sessionStats key into SessionProjectionMap for useProjection.
import type {} from '@arx-ai/arx-session-stats/client'
import type { ContextPressureProjection, TokenUsageProjection } from '@arx-ai/arx-token-meter/client'
import type { ComposerBarProps } from '../contract/slots.ts'
import { formatTokensPerSecond } from './message-chrome.ts'
import { assistantStepReading } from './turn-metrics.ts'
import { MEASURE_STYLE, useStatDialog } from './stat-dialog.ts'
import css from './StatsPills.module.css'
import dialogCss from './stat-dialog.module.css'

interface WindowStats {
  turns: number
  steps: number
  /** Summed request wall time (step/start → assistant/message); 0 when no node carries timing. */
  llmMs: number
  /** Summed tool wall time (tool/call → tool/result); 0 when no pair is in-window. */
  toolMs: number
  /** Summed first-token latency over `ttftSteps`; 0 when no step records it. */
  ttftMs: number
  /** Steps carrying a recorded TTFT. */
  ttftSteps: number
  /** Summed decode wall time over steps that also report output tokens. */
  decodeMs: number
  /** Summed output tokens over the same decode-timed steps. */
  decodeTokens: number
}

/**
 * Fold assistant and tool-result nodes into window-scoped display totals —
 * the FALLBACK for assemblies without the `sessionStats` projection.
 *
 * Every displayed figure rides that durable whole-log projection (and token
 * accounting rides `tokenUsage`) because the window is paged and compaction
 * rewrites it; this fold answers "what is on screen" only when no projection
 * value is served. Its field names deliberately mirror the projection's so
 * the two swap wholesale.
 * @param nodes - snapshot nodes.
 * @returns fallback counts and summed wall times.
 */
export function deriveStats(nodes: ConversationSnapshot['nodes']): WindowStats {
  const turns = new Set<number>()
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeMs = 0
  let decodeTokens = 0
  for (const node of nodes) {
    if (node.kind === 'tool-result') {
      if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime)
      continue
    }
    if (node.kind !== 'assistant') continue
    turns.add(node.turn)
    steps += 1
    if (node.timing !== undefined && node.timing.stepStartTime !== null) {
      llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime)
    }
    const reading = assistantStepReading(node)
    if (reading.ttftMs !== null) {
      ttftMs += reading.ttftMs
      ttftSteps += 1
    }
    if (reading.decodeMs !== null && reading.outputTokens !== null) {
      decodeMs += reading.decodeMs
      decodeTokens += reading.outputTokens
    }
  }
  return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
}

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits).
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Exact integer token count with locale-owned digit grouping.
 * @param n - non-negative safe integer token count.
 * @param t - the owning dock's locale seat.
 * @returns an unrounded display string.
 */
export function formatExactTokens(n: number, t: ComposerBarProps['t']): string {
  const digits = String(n)
  const groups: string[] = []
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end))
  }
  return groups.join(t('number.groupSeparator'))
}

/**
 * Compact duration: 45.2s under a minute, 2m42s from there on.
 * @param ms - duration in milliseconds.
 * @returns display string.
 */
export function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Round a cache-read ratio to an integer percentage, with positive ties rounded up. */
function roundedIntegerPercent(cacheReadTokens: number, denominator: number): number {
  const denominatorQuotient = Math.floor(denominator / 200)
  const denominatorRemainder = denominator % 200
  let lower = 0
  let upper = 100
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2)
    const factor = candidate * 2 - 1
    const threshold = factor * denominatorQuotient
      + Math.ceil(factor * denominatorRemainder / 200)
    if (cacheReadTokens >= threshold) {
      lower = candidate
    } else {
      upper = candidate - 1
    }
  }
  return lower
}

/**
 * Display-ready cache-hit share of prompt-side input over the whole durable log.
 * @param usage - the session's token-usage projection value.
 * @returns integer text when integer rounding stays below 100, otherwise the
 * minimum decimal precision that still rounds below 100; a full hit returns
 * 100, and no billed input returns null.
 */
export function cacheHitPercent(usage: TokenUsageProjection): string | null {
  const denominator = billedInputTokens(usage)
  if (denominator === 0) return null
  const missedInputTokens = usage.uncachedInputTokens + usage.cacheWriteTokens
  if (missedInputTokens === 0) return '100'

  const integerPercent = roundedIntegerPercent(usage.cacheReadTokens, denominator)
  if (integerPercent < 100) return String(integerPercent)

  // At the first distinguishing precision, the rounded result is 100 minus
  // one to five units in the final decimal place. Scale only while the next
  // multiplication remains at or below the denominator, then derive that
  // final digit through exact small-factor comparisons.
  let decimalPlaces = 1
  let scaledDoubleGap = missedInputTokens * 200
  const denominatorTens = Math.floor(denominator / 10)
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10
    decimalPlaces += 1
  }
  const denominatorOnes = denominator % 10
  let roundedLoss = 5
  for (let loss = 1; loss < 5; loss += 1) {
    const factor = loss * 2 + 1
    const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10)
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss
      break
    }
  }
  return `99.${'9'.repeat(decimalPlaces - 1)}${10 - roundedLoss}`
}

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

interface ContextOccupancy {
  percent: number
  usedTokens: number
  contextWindow: number
}

/**
 * Approximate context occupancy, using the TUI's integer rounding and upper
 * clamp. The numerator is `projectedTokens` — the provider sample carried
 * forward over the surface's movement since — so compaction shows immediately
 * instead of waiting for the next request to report usage; it falls back to the
 * bare sample only for a log whose projection predates that field. Numerator
 * and capacity remain independent last-wins projection fields, so this is a
 * reference figure rather than an exact measurement of one request (see the
 * token-meter README).
 * @param pressure - the session's context-pressure projection value.
 * @returns occupancy with its numerator and denominator, or null until both values are known.
 */
export function contextOccupancy(
  pressure: ContextPressureProjection | undefined,
): ContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

/** Props: the conversation-snapshot selector plus the projection read seat. */
export interface StatsPillsProps {
  /** Conversation snapshot selector; only settled nodes are read. */
  useSession: SnapshotSelectorHook<ConversationSnapshot>
  /** Projection read seat for `sessionStats` and `tokenUsage`. */
  useProjection: UseProjection
  /** The owning dock's locale seat. */
  t: ComposerBarProps['t']
}

type Translate = ComposerBarProps['t']

/** External open state one pill's dialog reads and writes (the row's exclusive slot). */
type PillDialog = Pick<ReturnType<typeof useStatDialog>, 'open' | 'setOpen'>

function exactCount(value: number, t: Translate): string {
  return t('stats.tokenCount', { count: formatExactTokens(value, t) })
}

function TimePill({ stats, t, dialog }: { stats: WindowStats; t: Translate; dialog: PillDialog }) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog(dialog)
  const counts = t('stats.counts', { turns: stats.turns, steps: stats.steps })
  const tps = stats.decodeMs > 0
    ? t('message.tokensPerSecond', {
      tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
    })
    : null
  const label = (
    <span className={css.label}>
      {counts}
      {tps !== null && (
        <>
          <span className={css.sep} aria-hidden>·</span>
          {tps}
        </>
      )}
    </span>
  )
  // A window without one timed figure has no dialog rows to show, so the pill
  // stays a plain reading instead of a button opening an empty dialog.
  if (stats.llmMs <= 0 && stats.toolMs <= 0 && stats.ttftSteps <= 0 && stats.decodeMs <= 0) {
    return (
      <span className={css.anchor}>
        <span className={css.pill}>
          <IconGaugeOutline16 />
          {label}
        </span>
      </span>
    )
  }
  return (
    <span ref={rootRef} className={css.anchor}>
      <button
        type="button"
        className={css.pill}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={tps === null ? counts : `${counts} · ${tps}`}
        onClick={() => { setOpen(!open) }}
      >
        <IconGaugeOutline16 />
        {label}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={t('stats.dialog.title')}
          style={pos ?? MEASURE_STYLE}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <IconGaugeOutline16 />
              {t('stats.dialog.title')}
            </span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          <dl className={dialogCss.details} data-session-stats-details>
            {stats.llmMs > 0 && (
              <>
                <dt>{t('stats.dialog.llmTime')}</dt>
                <dd>{formatDuration(stats.llmMs)}</dd>
              </>
            )}
            {stats.toolMs > 0 && (
              <>
                <dt>{t('stats.dialog.toolTime')}</dt>
                <dd>{formatDuration(stats.toolMs)}</dd>
              </>
            )}
            {stats.ttftSteps > 0 && (
              <>
                <dt>{t('stats.dialog.ttft')}</dt>
                <dd>{formatDuration(stats.ttftMs / stats.ttftSteps)}</dd>
              </>
            )}
            {tps !== null && (
              <>
                <dt>{t('stats.dialog.speed')}</dt>
                <dd>{tps}</dd>
              </>
            )}
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}

function UsagePill({ usage, t, dialog }: { usage: TokenUsageProjection; t: Translate; dialog: PillDialog }) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog(dialog)
  // Every prompt-side billing bucket plus output.
  const total = billedInputTokens(usage) + usage.outputTokens
  const totalText = t('stats.tokenCount', { count: formatTokens(total) })
  const cacheHit = cacheHitPercent(usage)
  const cacheHitText = cacheHit !== null ? t('stats.cacheHit', { percent: cacheHit }) : null
  return (
    <span ref={rootRef} className={css.anchor}>
      <button
        type="button"
        className={css.pill}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={cacheHitText === null ? totalText : `${totalText} · ${cacheHitText}`}
        onClick={() => { setOpen(!open) }}
      >
        <IconDatabaseOutline16 />
        <span className={css.label}>
          {totalText}
          {cacheHitText !== null && (
            <>
              <span className={css.sep} aria-hidden>·</span>
              {cacheHitText}
            </>
          )}
        </span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={t('stats.dialog.usageTitle')}
          style={pos ?? MEASURE_STYLE}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <IconDatabaseOutline16 />
              {t('stats.dialog.usageTitle')}
            </span>
            <span className={dialogCss.titleValue}>{exactCount(total, t)}</span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          {/* A session that never wrote cache drops that row; the other
              buckets are always present in the projection. */}
          <dl className={dialogCss.details} data-session-stats-usage>
            {cacheHit !== null && (
              <>
                <dt>{t('stats.dialog.cacheHit')}</dt>
                <dd>{`${cacheHit}%`}</dd>
              </>
            )}
            <dt>{t('stats.dialog.uncachedInput')}</dt>
            <dd>{exactCount(usage.uncachedInputTokens, t)}</dd>
            <dt>{t('stats.dialog.cachedInput')}</dt>
            <dd>{exactCount(usage.cacheReadTokens, t)}</dd>
            {usage.cacheWriteTokens !== 0 && (
              <>
                <dt>{t('stats.dialog.cacheWrite')}</dt>
                <dd>{exactCount(usage.cacheWriteTokens, t)}</dd>
              </>
            )}
            <dt>{t('stats.dialog.output')}</dt>
            <dd>{exactCount(usage.outputTokens, t)}</dd>
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}

/**
 * Render the composer-dock session stats: the time pill and the token-usage pill.
 * @param props - see {@link StatsPillsProps}.
 * @returns the pills row, or null before a step settles or tokens are billed.
 */
export const StatsPills = memo(function StatsPills({ useSession, useProjection, t }: StatsPillsProps) {
  const settledNodes = useSession(s => s.chat.legacy.nodes)
  const usage = useProjection('tokenUsage')
  // One exclusive slot for both dialogs: opening either pill closes the other.
  const [openPill, setOpenPill] = useState<'time' | 'usage' | null>(null)
  // Every figure rides the durable sessionStats projection, so paging and
  // compaction cannot change any of them; an assembly without the unit falls
  // back to the window-scoped fold wholesale (same field names), paid only
  // while no projection value is served.
  const projected = useProjection('sessionStats')
  const stats = useMemo(() => projected ?? deriveStats(settledNodes), [projected, settledNodes])
  // Gated on actual token activity: a session whose steps all settled without
  // billing (e.g. every request failed) shows its counts without a usage pill.
  const hasTokens = usage !== undefined
    && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)
  if (stats.steps === 0 && !hasTokens) return null
  // Context occupancy lives on the dock's ContextMeter beside this row, not
  // here — one home per fact.
  return (
    <div className={css.root} data-composer-stats>
      {stats.steps > 0 && (
        <TimePill
          stats={stats}
          t={t}
          dialog={{
            open: openPill === 'time',
            setOpen: (open) => { setOpenPill(open ? 'time' : null) },
          }}
        />
      )}
      {hasTokens && (
        <UsagePill
          usage={usage}
          t={t}
          dialog={{
            open: openPill === 'usage',
            setOpen: (open) => { setOpenPill(open ? 'usage' : null) },
          }}
        />
      )}
    </div>
  )
})
