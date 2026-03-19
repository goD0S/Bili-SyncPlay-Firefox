import assert from "node:assert/strict";
import test from "node:test";
import type { PlaybackState } from "@bili-syncplay/protocol";
import {
  evaluateNonSharedPageGuard,
  hasRecentRemoteStopIntent,
  rememberRemotePlaybackForSuppression,
  shouldApplySelfPlayback,
  shouldForcePauseWhileWaitingForInitialRoomState,
  shouldSuppressLocalEcho,
  shouldSuppressRemotePlayTransition,
} from "../src/content/sync-guards";

function createPlayback(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    url: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
    currentTime: 12,
    playState: "paused",
    playbackRate: 1,
    updatedAt: 1,
    serverTime: 1,
    actorId: "remote-member",
    seq: 1,
    ...overrides,
  };
}

test("suppresses autoplay while waiting for initial hydration without a recent user gesture", () => {
  assert.equal(
    shouldForcePauseWhileWaitingForInitialRoomState({
      activeRoomCode: "ROOM01",
      pendingRoomStateHydration: true,
      videoPaused: false,
      now: 5_000,
      lastUserGestureAt: 2_000,
      userGestureGraceMs: 1_200,
    }),
    true,
  );
});

test("allows user-initiated playback during initial hydration grace window", () => {
  assert.equal(
    shouldForcePauseWhileWaitingForInitialRoomState({
      activeRoomCode: "ROOM01",
      pendingRoomStateHydration: true,
      videoPaused: false,
      now: 5_000,
      lastUserGestureAt: 4_400,
      userGestureGraceMs: 1_200,
    }),
    false,
  );
});

test("protects non-shared pages from remote autoplay unless the user explicitly started playback", () => {
  const blocked = evaluateNonSharedPageGuard({
    activeRoomCode: "ROOM01",
    activeSharedUrl: "https://www.bilibili.com/video/BV1shared?p=1",
    normalizedCurrentUrl: "https://www.bilibili.com/video/BV1other?p=1",
    videoPaused: false,
    explicitNonSharedPlaybackUrl: null,
    lastExplicitPlaybackAction: null,
    now: 8_000,
    userGestureGraceMs: 1_200,
  });
  assert.deepEqual(blocked, {
    shouldPause: true,
    nextExplicitNonSharedPlaybackUrl: null,
  });

  const allowed = evaluateNonSharedPageGuard({
    activeRoomCode: "ROOM01",
    activeSharedUrl: "https://www.bilibili.com/video/BV1shared?p=1",
    normalizedCurrentUrl: "https://www.bilibili.com/video/BV1other?p=1",
    videoPaused: false,
    explicitNonSharedPlaybackUrl: null,
    lastExplicitPlaybackAction: {
      playState: "playing",
      at: 7_400,
    },
    now: 8_000,
    userGestureGraceMs: 1_200,
  });
  assert.deepEqual(allowed, {
    shouldPause: false,
    nextExplicitNonSharedPlaybackUrl:
      "https://www.bilibili.com/video/BV1other?p=1",
  });
});

test("suppresses local echo for matching remote playback within the guard window", () => {
  const memory = rememberRemotePlaybackForSuppression({
    playback: createPlayback({
      playState: "paused",
      currentTime: 25,
    }),
    normalizedUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
    now: 10_000,
    remoteEchoSuppressionMs: 700,
    remotePlayTransitionGuardMs: 1_800,
  });

  const decision = shouldSuppressLocalEcho({
    suppressedRemotePlayback: memory.suppressedRemotePlayback,
    normalizedCurrentUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
    playState: "paused",
    currentTime: 25.05,
    playbackRate: 1,
    now: 10_100,
  });

  assert.equal(decision.shouldSuppress, true);
  assert.deepEqual(
    decision.nextSuppressedRemotePlayback,
    memory.suppressedRemotePlayback,
  );
});

test("reapplies remote stop intent when an unexpected resume happens shortly after a remote pause", () => {
  const memory = rememberRemotePlaybackForSuppression({
    playback: createPlayback({
      playState: "paused",
      currentTime: 30,
    }),
    normalizedUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
    now: 20_000,
    remoteEchoSuppressionMs: 700,
    remotePlayTransitionGuardMs: 1_800,
  });

  assert.equal(
    hasRecentRemoteStopIntent({
      now: 20_300,
      pauseHoldUntil: 21_000,
      normalizedCurrentUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
      activeSharedUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
      intendedPlayState: "paused",
      suppressedRemotePlayback: memory.suppressedRemotePlayback,
    }),
    true,
  );
});

test("suppresses pause echo right after a remote playing intent unless it was user initiated", () => {
  const memory = rememberRemotePlaybackForSuppression({
    playback: createPlayback({
      playState: "playing",
      currentTime: 48,
    }),
    normalizedUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
    now: 30_000,
    remoteEchoSuppressionMs: 700,
    remotePlayTransitionGuardMs: 1_800,
  });

  const suppressed = shouldSuppressRemotePlayTransition({
    recentRemotePlayingIntent: memory.recentRemotePlayingIntent,
    normalizedCurrentUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
    playState: "paused",
    currentTime: 48.4,
    lastExplicitPlaybackAction: null,
    now: 30_400,
    userGestureGraceMs: 1_200,
  });
  assert.equal(suppressed.shouldSuppress, true);

  const allowed = shouldSuppressRemotePlayTransition({
    recentRemotePlayingIntent: memory.recentRemotePlayingIntent,
    normalizedCurrentUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=1",
    playState: "paused",
    currentTime: 48.4,
    lastExplicitPlaybackAction: {
      playState: "paused",
      at: 30_100,
    },
    now: 30_400,
    userGestureGraceMs: 1_200,
  });
  assert.equal(allowed.shouldSuppress, false);
});

test("applies self playback only when paused state, timeline, or rate actually diverge", () => {
  assert.equal(
    shouldApplySelfPlayback({
      videoPaused: true,
      videoCurrentTime: 12,
      videoPlaybackRate: 1,
      playback: createPlayback({
        playState: "playing",
        currentTime: 12,
        playbackRate: 1,
      }),
    }),
    true,
  );

  assert.equal(
    shouldApplySelfPlayback({
      videoPaused: false,
      videoCurrentTime: 12.1,
      videoPlaybackRate: 1,
      playback: createPlayback({
        playState: "playing",
        currentTime: 12,
        playbackRate: 1,
      }),
    }),
    false,
  );
});
