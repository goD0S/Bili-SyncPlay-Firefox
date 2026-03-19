import assert from "node:assert/strict";
import test from "node:test";
import {
  applyIncomingPopupState,
  createPopupStateSyncState,
} from "../src/popup/state-sync";
import type { BackgroundToPopupMessage } from "../src/shared/messages";

function createPopupState(
  roomCode: string | null,
): BackgroundToPopupMessage["payload"] {
  return {
    connected: Boolean(roomCode),
    serverUrl: "ws://localhost:8787",
    error: null,
    roomCode,
    joinToken: roomCode ? `join-${roomCode}` : null,
    memberId: roomCode ? `member-${roomCode}` : null,
    roomState: roomCode
      ? {
          roomCode,
          sharedVideo: null,
          playback: null,
          members: [],
        }
      : null,
    pendingCreateRoom: false,
    pendingJoinRoomCode: null,
    retryInMs: null,
    retryAttempt: 0,
    retryAttemptMax: 5,
    clockOffsetMs: null,
    rttMs: null,
    logs: [],
  };
}

test("query snapshot is ignored after a newer port snapshot has been received", () => {
  const state = createPopupStateSyncState();
  const newerState = createPopupState("ROOM02");
  const olderQueryState = createPopupState("ROOM01");

  assert.equal(applyIncomingPopupState(state, newerState, "port"), true);
  assert.equal(applyIncomingPopupState(state, olderQueryState, "query"), false);
  assert.equal(state.popupState?.roomCode, "ROOM02");
});

test("query snapshot is accepted as fallback before any port snapshot arrives", () => {
  const state = createPopupStateSyncState();
  const initialState = createPopupState("ROOM01");

  assert.equal(applyIncomingPopupState(state, initialState, "query"), true);
  assert.equal(state.popupState?.roomCode, "ROOM01");
  assert.equal(state.hasReceivedPortState, false);
});
