import type { SendMessage, Session } from "./types.js";
import type { RoomEventBus } from "./room-event-bus.js";

export async function createRoomEventConsumer(options: {
  roomEventBus: RoomEventBus;
  getRoomStateByCode: (
    roomCode: string,
  ) => Promise<import("./types.js").RoomStoreRoomState | null>;
  listLocalSessionsByRoom: (roomCode: string) => Session[];
  send: SendMessage;
}): Promise<{ close: () => Promise<void> }> {
  const unsubscribe = await options.roomEventBus.subscribe(async (message) => {
    const state =
      message.type === "room_deleted"
        ? {
            roomCode: message.roomCode,
            sharedVideo: null,
            playback: null,
            members: [],
          }
        : await options.getRoomStateByCode(message.roomCode);
    if (!state) {
      return;
    }

    for (const session of options.listLocalSessionsByRoom(message.roomCode)) {
      options.send(session.socket, {
        type: "room:state",
        payload: state,
      });
    }
  });

  return {
    async close() {
      await unsubscribe();
    },
  };
}
