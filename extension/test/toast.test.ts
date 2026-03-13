import assert from "node:assert/strict";
import test from "node:test";
import type { RoomState } from "@bili-syncplay/protocol";
import { getRoomStateToastMessages, getSharedVideoToastMessage } from "../src/content/toast";

function createRoomState(args: {
  members?: Array<{ id: string; name: string }>;
  sharedUrl?: string | null;
  playback?: RoomState["playback"];
} = {}): RoomState {
  return {
    roomCode: "ROOM01",
    sharedVideo: args.sharedUrl
      ? {
          videoId: "BV1xx411c7mD",
          url: args.sharedUrl,
          title: "Video"
        }
      : null,
    playback: args.playback ?? null,
    members: args.members ?? []
  };
}

test("builds member join and leave toast messages", () => {
  const previousState = createRoomState({
    members: [
      { id: "self", name: "Me" },
      { id: "a", name: "Alice" }
    ],
    sharedUrl: "https://www.bilibili.com/video/BV1?p=1"
  });
  const nextState = createRoomState({
    members: [
      { id: "self", name: "Me" },
      { id: "b", name: "Bob" }
    ],
    sharedUrl: "https://www.bilibili.com/video/BV1?p=1"
  });

  const result = getRoomStateToastMessages({
    previousState,
    nextState,
    localMemberId: "self",
    pendingRoomStateHydration: false,
    isCurrentPageShowingSharedVideo: false,
    now: 1000,
    lastSeekToastByActor: new Map()
  });

  assert.deepEqual(result.messages, ["Bob 加入了房间", "Alice 离开了房间"]);
});

test("builds seek and rate toast messages for remote playback changes", () => {
  const previousState = createRoomState({
    members: [
      { id: "self", name: "Me" },
      { id: "remote", name: "Alice" }
    ],
    sharedUrl: "https://www.bilibili.com/video/BV1?p=1",
    playback: {
      url: "https://www.bilibili.com/video/BV1?p=1",
      currentTime: 10,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 1,
      serverTime: 1,
      actorId: "remote",
      seq: 1
    }
  });
  const nextState = createRoomState({
    members: [
      { id: "self", name: "Me" },
      { id: "remote", name: "Alice" }
    ],
    sharedUrl: "https://www.bilibili.com/video/BV1?p=1",
    playback: {
      url: "https://www.bilibili.com/video/BV1?p=1",
      currentTime: 42,
      playState: "paused",
      playbackRate: 1.5,
      updatedAt: 2,
      serverTime: 2,
      actorId: "remote",
      seq: 2
    }
  });

  const result = getRoomStateToastMessages({
    previousState,
    nextState,
    localMemberId: "self",
    pendingRoomStateHydration: false,
    isCurrentPageShowingSharedVideo: true,
    now: 1000,
    lastSeekToastByActor: new Map()
  });

  assert.deepEqual(result.messages, ["Alice 切换到 1.5x", "Alice 跳转到 0:42"]);
});

test("builds shared video toast for another member only once", () => {
  const state = createRoomState({
    members: [
      { id: "self", name: "Me" },
      { id: "remote", name: "Alice" }
    ],
    sharedUrl: "https://www.bilibili.com/video/BV1?p=1"
  });

  const first = getSharedVideoToastMessage({
    toast: {
      key: "toast-1",
      actorId: "remote",
      title: "New Video",
      videoUrl: "https://www.bilibili.com/video/BV1?p=1"
    },
    state,
    localMemberId: "self",
    lastSharedVideoToastKey: null,
    normalizedToastUrl: "https://www.bilibili.com/video/BV1?p=1",
    normalizedSharedUrl: "https://www.bilibili.com/video/BV1?p=1"
  });
  assert.equal(first.message, "Alice 共享了新视频：New Video");
  assert.equal(first.nextSharedVideoToastKey, "toast-1");

  const repeated = getSharedVideoToastMessage({
    toast: {
      key: "toast-1",
      actorId: "remote",
      title: "New Video",
      videoUrl: "https://www.bilibili.com/video/BV1?p=1"
    },
    state,
    localMemberId: "self",
    lastSharedVideoToastKey: "toast-1",
    normalizedToastUrl: "https://www.bilibili.com/video/BV1?p=1",
    normalizedSharedUrl: "https://www.bilibili.com/video/BV1?p=1"
  });
  assert.equal(repeated.message, null);
});
