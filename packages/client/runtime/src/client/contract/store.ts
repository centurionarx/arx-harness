/** One store engine is shared by application and project trees. */
export { createSnapshotStore, defineStore, shallowEqual } from '@arx-ai/arx-client-slots/client'
export type {
  ActionsDecl, BakedActions, BoundActions, StoreFactory, StoreHandle, StoreInstance, StoreSpec,
  EngineStoreHandle, EngineStoreInstance, ObservableSnapshot, SnapshotStore,
} from '@arx-ai/arx-client-slots/client'
