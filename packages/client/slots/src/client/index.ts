/** Neutral Cordis slot provider and React-free observable/store engine. */
import type { Context } from '@arx-ai/cordis'
import type {} from '@arx-ai/arx-client-ui-slots/composition'
import { SlotRegistry } from './registry.ts'
export { SlotRegistry, type RootOwnerProps } from './registry.ts'
export { createSnapshotStore, defineStore, shallowEqual } from './store.ts'
export type {
  ActionsDecl, BakedActions, BoundActions, StoreFactory, StoreHandle, StoreInstance, StoreSpec,
  EngineStoreHandle, EngineStoreInstance, ObservableSnapshot, SnapshotStore,
} from './store.ts'
declare module '@arx-ai/cordis' {
  interface Context {
    slots: SlotRegistry
  }
  interface Events {
    /** Slot mutation has already committed before this event fires. @mode emit */
    'slots/changed'(key: string): void
  }
}
/** Provide one registry for the current tree. */
export function apply(ctx: Context): void { new SlotRegistry(ctx) }
