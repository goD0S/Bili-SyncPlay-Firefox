import {
  createContentRuntimeState,
  type ContentRuntimeState,
} from "./runtime-state";

export type ContentRuntimeStatePatch = Partial<ContentRuntimeState>;

export interface ContentStateStore {
  getState(): ContentRuntimeState;
  patch(patch: ContentRuntimeStatePatch): ContentRuntimeState;
  replace(nextState: ContentRuntimeState): ContentRuntimeState;
  reset(): ContentRuntimeState;
}

export function createContentStateStore(): ContentStateStore {
  const state = createContentRuntimeState();

  return {
    getState() {
      return state;
    },
    patch(patch) {
      Object.assign(state, patch);
      return state;
    },
    replace(nextState) {
      Object.assign(state, nextState);
      return state;
    },
    reset() {
      Object.assign(state, createContentRuntimeState());
      return state;
    },
  };
}
