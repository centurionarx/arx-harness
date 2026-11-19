/** Presentation tree metadata only; no project service or renderer dependencies. */
import type { Context } from '@arx-ai/cordis'
/** Readonly presentation metadata shared by browser and request index composition. */
export type CompositionContextView = Pick<Context, 'clientComposition'>
/** Client composition view; server identity and audience remain authoritative. */
export interface ClientComposition {
  readonly kind: 'public' | 'admin' | 'user'
  readonly audience: 'user' | 'admin'
  readonly generation?: number
  /** Internal fixed tree scope, derived from the validated auth response; absent retains legacy project behavior. */
  readonly scope?: 'application' | 'project'
}

declare module '@arx-ai/cordis' {
  interface Context {
    /** A readonly tree view, never an authentication or ownership capability. */
    readonly clientComposition?: ClientComposition
  }
}
