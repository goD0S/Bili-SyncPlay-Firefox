import type { ActiveRoom, Session } from "./types.js";

type KickedMemberBlock = {
  memberToken: string;
  expiresAt: number;
};

export type ActiveRoomRegistry = {
  getRoom: (code: string) => ActiveRoom | null;
  getOrCreateRoom: (code: string) => ActiveRoom;
  addMember: (
    code: string,
    memberId: string,
    session: Session,
    memberToken: string,
  ) => ActiveRoom;
  findMemberIdByToken: (code: string, memberToken: string) => string | null;
  blockMemberToken: (
    code: string,
    memberToken: string,
    expiresAt: number,
  ) => void;
  isMemberTokenBlocked: (
    code: string,
    memberToken: string,
    currentTime?: number,
  ) => boolean;
  removeMember: (
    code: string,
    memberId: string,
    session?: Session,
  ) => { room: ActiveRoom | null; roomEmpty: boolean };
  deleteRoom: (code: string) => void;
};

export function createActiveRoomRegistry(): ActiveRoomRegistry {
  const rooms = new Map<string, ActiveRoom>();
  const blockedMemberTokensByRoom = new Map<string, KickedMemberBlock[]>();

  function pruneBlockedMemberTokens(
    code: string,
    currentTime: number,
  ): KickedMemberBlock[] {
    const entries = blockedMemberTokensByRoom.get(code) ?? [];
    const activeEntries = entries.filter(
      (entry) => entry.expiresAt > currentTime,
    );
    if (activeEntries.length === 0) {
      blockedMemberTokensByRoom.delete(code);
      return [];
    }
    if (activeEntries.length !== entries.length) {
      blockedMemberTokensByRoom.set(code, activeEntries);
    }
    return activeEntries;
  }

  function getOrCreateRoom(code: string): ActiveRoom {
    const existingRoom = rooms.get(code);
    if (existingRoom) {
      return existingRoom;
    }

    const room: ActiveRoom = {
      code,
      members: new Map(),
      memberTokens: new Map(),
    };
    rooms.set(code, room);
    return room;
  }

  return {
    getRoom(code) {
      return rooms.get(code) ?? null;
    },
    getOrCreateRoom,
    addMember(code, memberId, session, memberToken) {
      const room = getOrCreateRoom(code);
      room.members.set(memberId, session);
      room.memberTokens.set(memberId, memberToken);
      return room;
    },
    findMemberIdByToken(code, memberToken) {
      const room = rooms.get(code) ?? null;
      if (!room) {
        return null;
      }

      for (const [memberId, token] of room.memberTokens.entries()) {
        if (token === memberToken) {
          return memberId;
        }
      }
      return null;
    },
    blockMemberToken(code, memberToken, expiresAt) {
      const activeEntries = pruneBlockedMemberTokens(code, Date.now());
      activeEntries.push({ memberToken, expiresAt });
      blockedMemberTokensByRoom.set(code, activeEntries);
    },
    isMemberTokenBlocked(code, memberToken, currentTime = Date.now()) {
      const activeEntries = pruneBlockedMemberTokens(code, currentTime);
      return activeEntries.some((entry) => entry.memberToken === memberToken);
    },
    removeMember(code, memberId, session) {
      const room = rooms.get(code) ?? null;
      if (!room) {
        return { room: null, roomEmpty: true };
      }

      if (session) {
        const currentSession = room.members.get(memberId);
        if (currentSession && currentSession !== session) {
          return { room, roomEmpty: false };
        }
      }

      room.members.delete(memberId);
      room.memberTokens.delete(memberId);
      const roomEmpty = room.members.size === 0;
      if (roomEmpty) {
        rooms.delete(code);
      }
      return { room: roomEmpty ? null : room, roomEmpty };
    },
    deleteRoom(code) {
      rooms.delete(code);
      blockedMemberTokensByRoom.delete(code);
    },
  };
}
