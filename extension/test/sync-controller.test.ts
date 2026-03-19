import assert from "node:assert/strict";
import test from "node:test";
import { createContentRuntimeState } from "../src/content/runtime-state";
import { createSyncController } from "../src/content/sync-controller";

function installWindowStub() {
  const originalWindow = globalThis.window;
  const scheduled: Array<() => void> = [];
  let nextTimer = 1;

  const windowStub = {
    setTimeout(callback: () => void) {
      scheduled.push(callback);
      return nextTimer++;
    },
    clearTimeout(_timer: number) {},
  };

  Object.assign(globalThis, { window: windowStub });

  return {
    scheduled,
    restore() {
      Object.assign(globalThis, { window: originalWindow });
    },
  };
}

function createControllerHarness() {
  const runtimeState = createContentRuntimeState();
  const lastAppliedVersionByActor = new Map<
    string,
    { serverTime: number; seq: number }
  >();
  const debugLogs: string[] = [];
  const runtimeMessages: Array<unknown> = [];
  let hydrateRetryTimer: number | null = null;

  const controller = createSyncController({
    runtimeState,
    lastAppliedVersionByActor,
    broadcastLogState: { key: null, at: 0 },
    ignoredSelfPlaybackLogState: { key: null, at: 0 },
    localIntentGuardMs: 500,
    pauseHoldMs: 1_000,
    initialRoomStatePauseHoldMs: 1_500,
    remoteEchoSuppressionMs: 800,
    remotePlayTransitionGuardMs: 500,
    userGestureGraceMs: 300,
    nextSeq: () => 1,
    markBroadcastAt: () => {},
    getNow: () => 10_000,
    debugLog: (message) => {
      debugLogs.push(message);
    },
    shouldLogHeartbeat: () => true,
    runtimeSendMessage: async (message) => {
      runtimeMessages.push(message);
      return null;
    },
    getHydrateRetryTimer: () => hydrateRetryTimer,
    setHydrateRetryTimer: (timer) => {
      hydrateRetryTimer = timer;
    },
    getVideoElement: () => null,
    getCurrentPlaybackVideo: async () => null,
    getSharedVideo: () => null,
    normalizeUrl: (url) => url?.trim() ?? null,
    notifyRoomStateToasts: () => {},
    maybeShowSharedVideoToast: () => {},
  });

  return {
    runtimeState,
    controller,
    debugLogs,
    runtimeMessages,
    get hydrateRetryTimer() {
      return hydrateRetryTimer;
    },
  };
}

test("sync controller skips playback broadcast before hydration becomes ready", async () => {
  const harness = createControllerHarness();
  const video = {
    paused: false,
    readyState: 4,
    currentTime: 12,
    playbackRate: 1,
  } as HTMLVideoElement;

  await harness.controller.broadcastPlayback(video);

  assert.equal(harness.runtimeMessages.length, 0);
  assert.equal(
    harness.debugLogs.includes("Skip broadcast before hydration ready"),
    true,
  );
});

test("sync controller accepts empty room hydration and clears active shared url", async () => {
  const harness = createControllerHarness();
  harness.runtimeState.activeSharedUrl =
    "https://www.bilibili.com/video/BV1xx411c7mD";
  harness.runtimeState.pendingRoomStateHydration = true;

  await harness.controller.applyRoomState({
    roomCode: "ROOM01",
    sharedVideo: null,
    playback: null,
    members: [],
  });

  assert.equal(harness.runtimeState.activeSharedUrl, null);
  assert.equal(harness.runtimeState.pendingRoomStateHydration, false);
  assert.equal(harness.runtimeState.hasReceivedInitialRoomState, true);
});

test("sync controller schedules hydration retry when room exists but initial room state is still unavailable", async () => {
  const windowHarness = installWindowStub();
  const harness = createControllerHarness();
  harness.runtimeState.activeRoomCode = "ROOM02";

  harness.controller = createSyncController({
    runtimeState: harness.runtimeState,
    lastAppliedVersionByActor: new Map(),
    broadcastLogState: { key: null, at: 0 },
    ignoredSelfPlaybackLogState: { key: null, at: 0 },
    localIntentGuardMs: 500,
    pauseHoldMs: 1_000,
    initialRoomStatePauseHoldMs: 1_500,
    remoteEchoSuppressionMs: 800,
    remotePlayTransitionGuardMs: 500,
    userGestureGraceMs: 300,
    nextSeq: () => 1,
    markBroadcastAt: () => {},
    getNow: () => 10_000,
    debugLog: (message) => {
      harness.debugLogs.push(message);
    },
    shouldLogHeartbeat: () => true,
    runtimeSendMessage: async () => ({
      memberId: "member-2",
      roomCode: "ROOM02",
    }),
    getHydrateRetryTimer: () => harness.hydrateRetryTimer,
    setHydrateRetryTimer: (_timer) => {},
    getVideoElement: () => null,
    getCurrentPlaybackVideo: async () => null,
    getSharedVideo: () => null,
    normalizeUrl: (url) => url?.trim() ?? null,
    notifyRoomStateToasts: () => {},
    maybeShowSharedVideoToast: () => {},
  });

  try {
    await harness.controller.hydrateRoomState();

    assert.equal(windowHarness.scheduled.length, 1);
    assert.equal(
      harness.debugLogs.some((message) =>
        message.includes("Hydrate pending for ROOM02"),
      ),
      true,
    );
    assert.equal(harness.runtimeState.hydrationReady, false);
  } finally {
    windowHarness.restore();
  }
});
