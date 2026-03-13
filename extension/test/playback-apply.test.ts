import assert from "node:assert/strict";
import test from "node:test";
import type { RoomState } from "@bili-syncplay/protocol";
import { decidePlaybackApplication } from "../src/content/playback-apply";

function createRoomState(sharedUrl: string | null, playbackOverrides: Partial<NonNullable<RoomState["playback"]>> = {}): RoomState {
  return {
    roomCode: "ROOM01",
    sharedVideo: sharedUrl
      ? {
          videoId: "BV1xx411c7mD",
          url: sharedUrl,
          title: "Video"
        }
      : null,
    playback: sharedUrl
      ? {
          url: sharedUrl,
          currentTime: 12,
          playState: "paused",
          playbackRate: 1,
          updatedAt: 1,
          serverTime: 10,
          actorId: "remote-member",
          seq: 2,
          ...playbackOverrides
        }
      : null,
    members: []
  };
}

test("accepts empty room state during hydration", () => {
  assert.deepEqual(
    decidePlaybackApplication({
      roomState: createRoomState(null),
      currentVideo: null,
      normalizedSharedUrl: null,
      normalizedCurrentUrl: null,
      normalizedPlaybackUrl: null,
      pendingRoomStateHydration: true,
      explicitNonSharedPlaybackUrl: null,
      now: 1_000,
      lastLocalIntentAt: 0,
      lastLocalIntentPlayState: null,
      localIntentGuardMs: 1_200,
      lastAppliedVersion: null,
      localMemberId: null
    }),
    {
      kind: "empty-room",
      acceptedHydration: true
    }
  );
});

test("protects non-shared page during hydration", () => {
  assert.deepEqual(
    decidePlaybackApplication({
      roomState: createRoomState("https://www.bilibili.com/video/BVshared?p=1"),
      currentVideo: {
        videoId: "BVother",
        url: "https://www.bilibili.com/video/BVother?p=1",
        title: "Other"
      },
      normalizedSharedUrl: "https://www.bilibili.com/video/BVshared?p=1",
      normalizedCurrentUrl: "https://www.bilibili.com/video/BVother?p=1",
      normalizedPlaybackUrl: "https://www.bilibili.com/video/BVshared?p=1",
      pendingRoomStateHydration: true,
      explicitNonSharedPlaybackUrl: null,
      now: 1_000,
      lastLocalIntentAt: 0,
      lastLocalIntentPlayState: null,
      localIntentGuardMs: 1_200,
      lastAppliedVersion: null,
      localMemberId: null
    }),
    {
      kind: "ignore-non-shared",
      acceptedHydration: true,
      shouldPauseNonSharedVideo: true
    }
  );
});

test("ignores conflicting remote resume during local pause guard", () => {
  assert.equal(
    decidePlaybackApplication({
      roomState: createRoomState("https://www.bilibili.com/video/BVshared?p=1", {
        playState: "playing"
      }),
      currentVideo: {
        videoId: "BVshared",
        url: "https://www.bilibili.com/video/BVshared?p=1",
        title: "Shared"
      },
      normalizedSharedUrl: "https://www.bilibili.com/video/BVshared?p=1",
      normalizedCurrentUrl: "https://www.bilibili.com/video/BVshared?p=1",
      normalizedPlaybackUrl: "https://www.bilibili.com/video/BVshared?p=1",
      pendingRoomStateHydration: false,
      explicitNonSharedPlaybackUrl: null,
      now: 1_500,
      lastLocalIntentAt: 1_000,
      lastLocalIntentPlayState: "paused",
      localIntentGuardMs: 1_200,
      lastAppliedVersion: null,
      localMemberId: null
    }).kind,
    "ignore-local-guard"
  );
});

test("ignores stale playback updates by actor version", () => {
  assert.equal(
    decidePlaybackApplication({
      roomState: createRoomState("https://www.bilibili.com/video/BVshared?p=1", {
        serverTime: 10,
        seq: 2
      }),
      currentVideo: {
        videoId: "BVshared",
        url: "https://www.bilibili.com/video/BVshared?p=1",
        title: "Shared"
      },
      normalizedSharedUrl: "https://www.bilibili.com/video/BVshared?p=1",
      normalizedCurrentUrl: "https://www.bilibili.com/video/BVshared?p=1",
      normalizedPlaybackUrl: "https://www.bilibili.com/video/BVshared?p=1",
      pendingRoomStateHydration: false,
      explicitNonSharedPlaybackUrl: null,
      now: 3_000,
      lastLocalIntentAt: 0,
      lastLocalIntentPlayState: null,
      localIntentGuardMs: 1_200,
      lastAppliedVersion: {
        serverTime: 10,
        seq: 2
      },
      localMemberId: null
    }).kind,
    "ignore-stale-playback"
  );
});

test("returns apply decision for current shared playback", () => {
  const decision = decidePlaybackApplication({
    roomState: createRoomState("https://www.bilibili.com/video/BVshared?p=1", {
      actorId: "member-1"
    }),
    currentVideo: {
      videoId: "BVshared",
      url: "https://www.bilibili.com/video/BVshared?p=1",
      title: "Shared"
    },
    normalizedSharedUrl: "https://www.bilibili.com/video/BVshared?p=1",
    normalizedCurrentUrl: "https://www.bilibili.com/video/BVshared?p=1",
    normalizedPlaybackUrl: "https://www.bilibili.com/video/BVshared?p=1",
    pendingRoomStateHydration: false,
    explicitNonSharedPlaybackUrl: null,
    now: 4_000,
    lastLocalIntentAt: 0,
    lastLocalIntentPlayState: null,
    localIntentGuardMs: 1_200,
    lastAppliedVersion: null,
    localMemberId: "member-1"
  });

  assert.equal(decision.kind, "apply");
  if (decision.kind === "apply") {
    assert.equal(decision.isSelfPlayback, true);
    assert.equal(decision.playback.actorId, "member-1");
  }
});
