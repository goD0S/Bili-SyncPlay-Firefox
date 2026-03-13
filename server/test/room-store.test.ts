import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryRoomStore, roomStateOf } from "../src/room-store";
import type { Session } from "../src/types";

test("room store creates unique room codes and persists rooms", () => {
  const roomCodes = ["AAAAAA", "AAAAAA", "BBBBBB"];
  const joinTokens = ["join-1", "join-2"];
  const store = createInMemoryRoomStore({
    createRoomCode: () => roomCodes.shift() ?? "ZZZZZZ",
    generateToken: () => joinTokens.shift() ?? "join-final",
    now: () => 123
  });

  const firstRoom = store.createRoom();
  const secondRoom = store.createRoom();

  assert.equal(firstRoom.code, "AAAAAA");
  assert.equal(firstRoom.joinToken, "join-1");
  assert.equal(secondRoom.code, "BBBBBB");
  assert.equal(secondRoom.joinToken, "join-2");
  assert.equal(store.getRoom("AAAAAA"), firstRoom);
  assert.equal(store.getRoom("BBBBBB"), secondRoom);
  assert.equal(store.hasRoom("CCCCCC"), false);
});

test("roomStateOf serializes room members and playback state", () => {
  const session = {
    id: "member-1",
    displayName: "Alice"
  } as Session;
  const room = {
    code: "ROOM01",
    joinToken: "join-token",
    createdAt: 1,
    sharedVideo: {
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      title: "Video",
      ownerName: "Owner",
      bvid: "BV1xx411c7mD",
      sharedByMemberId: "member-1"
    },
    playback: {
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      currentTime: 10,
      playState: "paused" as const,
      playbackRate: 1,
      updatedAt: 1,
      serverTime: 1,
      actorId: "member-1",
      seq: 2
    },
    members: new Map([[session.id, session]]),
    memberTokens: new Map([[session.id, "member-token"]])
  };

  assert.deepEqual(roomStateOf(room), {
    roomCode: "ROOM01",
    sharedVideo: room.sharedVideo,
    playback: room.playback,
    members: [{ id: "member-1", name: "Alice" }]
  });
});
