import type { Room, RoomStoreRoomState, Session } from "./types";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type RoomStore = {
  createRoom: () => Room;
  getRoom: (code: string) => Room | undefined;
  hasRoom: (code: string) => boolean;
  deleteRoom: (code: string) => void;
};

type CreateInMemoryRoomStoreOptions = {
  createRoomCode?: () => string;
  generateToken?: () => string;
  now?: () => number;
};

export function createRoomCode(): string {
  return Array.from({ length: 6 }, () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]).join("");
}

export function createInMemoryRoomStore(options: CreateInMemoryRoomStoreOptions = {}): RoomStore {
  const rooms = new Map<string, Room>();
  const nextRoomCode = options.createRoomCode ?? createRoomCode;
  const nextToken = options.generateToken ?? (() => {
    throw new Error("generateToken is required to create rooms.");
  });
  const now = options.now ?? Date.now;

  return {
    createRoom(): Room {
      let roomCode = nextRoomCode();
      while (rooms.has(roomCode)) {
        roomCode = nextRoomCode();
      }

      const room: Room = {
        code: roomCode,
        joinToken: nextToken(),
        createdAt: now(),
        sharedVideo: null,
        playback: null,
        members: new Map(),
        memberTokens: new Map()
      };
      rooms.set(roomCode, room);
      return room;
    },
    getRoom(code: string): Room | undefined {
      return rooms.get(code);
    },
    hasRoom(code: string): boolean {
      return rooms.has(code);
    },
    deleteRoom(code: string): void {
      rooms.delete(code);
    }
  };
}

export function roomStateOf(room: Room): RoomStoreRoomState {
  return {
    roomCode: room.code,
    sharedVideo: room.sharedVideo,
    playback: room.playback,
    members: Array.from(room.members.values()).map((member: Session) => ({
      id: member.id,
      name: member.displayName
    }))
  };
}
