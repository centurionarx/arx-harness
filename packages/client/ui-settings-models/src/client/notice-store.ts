/**
 * Acknowledgement state for a versioned onboarding notice, derived from the
 * settings scope that stores it. The scope is the transport: a loopback
 * browser follows the durable Host section, while a remote browser's
 * memory-mode scope never answers and the acknowledgement stays process-local
 * here.
 *
 * One store serves every notice because they differ only in which field holds
 * the acknowledgement and which version string counts as current.
 */

import type { SettingsScope, SnapshotStore } from '@arx-ai/arx-client-runtime/client'
import { createSnapshotStore } from '@arx-ai/arx-client-runtime/client'

/** State rendered by a notice step. */
export interface AcknowledgedNoticeState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  acknowledged: boolean
  error: string | null
}

/** The settings section a notice reads its acknowledgement from. */
export type NoticeSection = Record<string, unknown>

/**
 * Accept any object section verbatim; a malformed durable value reads as an
 * empty section, so the notice treats it as unacknowledged instead of leaving
 * the scope stuck on its previous value.
 * @param section - the wire section value.
 * @returns the section object, or an empty one for non-object values.
 */
export function decodeNoticeSection(section: unknown): NoticeSection {
  return typeof section === 'object' && section !== null && !Array.isArray(section)
    ? section as NoticeSection
    : {}
}

/* v8 ignore next 3 -- closed-union default only defends future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected notice settings status')
}

/** What one notice stores, and where. */
export interface AcknowledgedNoticeBinding {
  /** The settings namespace scope holding the acknowledgement. */
  scope: SettingsScope<NoticeSection>
  /** Field in that section recording the acknowledged version. */
  field: string
  /**
   * Version counted as current, compared for exact equality. Read per
   * comparison rather than captured: a notice whose version is a Host fact
   * learns it after this binding is made.
   */
  version: () => string
  /** What an unavailable namespace is reported as failing to acknowledge. */
  subject: string
}

/** Coordinates durable Host acknowledgement or a process-local remote fallback. */
export class AcknowledgedNoticeStore {
  /** uSES-safe state source shared by the registered notice step. */
  readonly store: SnapshotStore<AcknowledgedNoticeState> = createSnapshotStore<AcknowledgedNoticeState>({
    status: 'idle', acknowledged: false, error: null,
  })

  private localAcknowledged = false
  private saving = false
  private following: (() => void) | undefined

  /**
   * @param binding - the scope holding this notice's acknowledgement, the
   * field and version it compares, and the subject its failures name. The
   * scope's own memory mode is what keeps a remote browser process-local.
   */
  constructor(private readonly binding: AcknowledgedNoticeBinding) {}

  /**
   * Begin following the bound scope (idempotent) and publish its current answer.
   * @returns settlement after the current answer is published.
   */
  load(): Promise<void> {
    this.following ??= this.binding.scope.subscribe(() => { this.derive() })
    this.derive()
    return Promise.resolve()
  }

  /**
   * Persist this copy version, or advance only this process for a remote
   * browser. Success is judged against the state the write left behind, so a
   * refused or failed write reports false after its recovery read settles.
   * @returns true when the selected persistence mode holds the acknowledgement.
   */
  async acknowledge(): Promise<boolean> {
    if (this.binding.scope.getSnapshot().mode === 'memory') {
      this.localAcknowledged = true
      this.derive()
      return true
    }
    this.saving = true
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      await this.binding.scope.set(this.binding.field, this.binding.version())
    } finally {
      this.saving = false
    }
    this.derive()
    const { acknowledged } = this.store.getSnapshot()
    if (!acknowledged) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = 'the acknowledgement did not persist'
      })
    }
    return acknowledged
  }

  /** Stop following the scope. */
  dispose(): void {
    this.following?.()
    this.following = undefined
  }

  private derive(): void {
    if (this.saving) return
    const scope = this.binding.scope.getSnapshot()
    if (scope.mode === 'memory') {
      this.store.update((state) => {
        state.status = 'ready'
        state.acknowledged = this.localAcknowledged
        state.error = null
      })
      return
    }
    switch (scope.status) {
      case 'loading':
        this.store.update((state) => { state.status = 'loading'; state.error = null })
        return
      case 'unavailable':
        this.store.update((state) => {
          state.status = 'error'
          state.acknowledged = false
          state.error = `${this.binding.subject} acknowledgement settings are unavailable`
        })
        return
      case 'ready': {
        const acknowledged = scope.value?.[this.binding.field] === this.binding.version()
        this.store.update((state) => {
          state.status = 'ready'
          state.acknowledged = acknowledged
          state.error = null
        })
        return
      }
      /* v8 ignore next -- every current settings scope status is handled above */
      default: return assertNever(scope.status)
    }
  }
}
