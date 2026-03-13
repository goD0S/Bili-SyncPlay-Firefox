import type { BackgroundToPopupMessage } from "../shared/messages";

export interface PopupStateSyncState {
  popupState: BackgroundToPopupMessage["payload"] | null;
  hasReceivedPortState: boolean;
}

export function createPopupStateSyncState(): PopupStateSyncState {
  return {
    popupState: null,
    hasReceivedPortState: false
  };
}

export function applyIncomingPopupState(
  state: PopupStateSyncState,
  nextState: BackgroundToPopupMessage["payload"],
  source: "port" | "query"
): boolean {
  if (source === "query" && state.hasReceivedPortState) {
    return false;
  }

  state.popupState = nextState;
  if (source === "port") {
    state.hasReceivedPortState = true;
  }
  return true;
}
