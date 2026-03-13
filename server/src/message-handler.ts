import { normalizeBilibiliUrl, type ClientMessage, type ErrorCode, type PlaybackState, type ServerMessage } from "@bili-syncplay/protocol";
import { consumeFixedWindow, consumeTokenBucket, WINDOW_10_SECONDS_MS, WINDOW_MINUTE_MS } from "./rate-limit";
import { roomStateOf, type RoomStore } from "./room-store";
import type { LogEvent, Room, SecurityConfig, SendError, SendMessage, Session } from "./types";

const PAUSE_DOMINANCE_WINDOW_MS = 400;

type JoinedRoomAccess = { ok: true; room: Room } | { ok: false; code: ErrorCode; message: string };

export function createMessageHandler(options: {
  config: SecurityConfig;
  roomStore: RoomStore;
  logEvent: LogEvent;
  send: SendMessage;
  sendError: SendError;
  generateToken: () => string;
  now?: () => number;
}): {
  handleClientMessage: (session: Session, message: ClientMessage) => void;
  leaveRoom: (session: Session) => void;
} {
  const { config, roomStore, logEvent, send, sendError, generateToken } = options;
  const now = options.now ?? Date.now;

  function broadcastRoomState(room: Room): void {
    const message: ServerMessage = {
      type: "room:state",
      payload: roomStateOf(room)
    };

    for (const member of room.members.values()) {
      send(member.socket, message);
    }
  }

  function leaveRoom(session: Session): void {
    if (!session.roomCode) {
      return;
    }

    const roomCode = session.roomCode;
    const room = roomStore.getRoom(roomCode);
    session.roomCode = null;
    session.memberToken = null;
    session.joinedAt = null;

    if (!room) {
      return;
    }

    room.members.delete(session.id);
    room.memberTokens.delete(session.id);

    if (room.members.size === 0) {
      roomStore.deleteRoom(room.code);
      return;
    }

    broadcastRoomState(room);
    logEvent("room_left", {
      sessionId: session.id,
      roomCode,
      remoteAddress: session.remoteAddress,
      origin: session.origin,
      result: "ok"
    });
  }

  function joinRoom(session: Session, room: Room, memberToken: string): void {
    leaveRoom(session);
    room.members.set(session.id, session);
    room.memberTokens.set(session.id, memberToken);
    session.roomCode = room.code;
    session.memberToken = memberToken;
    session.joinedAt = now();
  }

  function shouldIgnorePlaybackUpdate(room: Room, nextPlayback: PlaybackState, currentTime: number): boolean {
    if (!room.playback) {
      return false;
    }

    const currentPlayback = room.playback;
    if (currentPlayback.actorId === nextPlayback.actorId) {
      return false;
    }
    const currentIsStopLike = currentPlayback.playState === "paused" || currentPlayback.playState === "buffering";
    const nextIsPlaying = nextPlayback.playState === "playing";
    const withinPauseWindow = currentTime - currentPlayback.serverTime < PAUSE_DOMINANCE_WINDOW_MS;
    const closeInTimeline = Math.abs(nextPlayback.currentTime - currentPlayback.currentTime) < 1.2;

    return currentIsStopLike && nextIsPlaying && withinPauseWindow && closeInTimeline;
  }

  function requireJoinedRoomSession(
    session: Session,
    messageType: ClientMessage["type"],
    memberToken: string | undefined
  ): JoinedRoomAccess {
    if (!session.roomCode) {
      logEvent("auth_failed", {
        sessionId: session.id,
        roomCode: null,
        remoteAddress: session.remoteAddress,
        origin: session.origin,
        messageType,
        result: "rejected",
        reason: "not_in_room"
      });
      return { ok: false, code: "not_in_room", message: "You must join a room first." };
    }

    const room = roomStore.getRoom(session.roomCode);
    if (!room) {
      session.roomCode = null;
      session.memberToken = null;
      session.joinedAt = null;
      logEvent("auth_failed", {
        sessionId: session.id,
        roomCode: null,
        remoteAddress: session.remoteAddress,
        origin: session.origin,
        messageType,
        result: "rejected",
        reason: "room_not_found"
      });
      return { ok: false, code: "room_not_found", message: "Room not found." };
    }

    if (!memberToken || !session.memberToken || memberToken !== session.memberToken) {
      logEvent("auth_failed", {
        sessionId: session.id,
        roomCode: room.code,
        remoteAddress: session.remoteAddress,
        origin: session.origin,
        messageType,
        result: "rejected",
        reason: "member_token_invalid"
      });
      return { ok: false, code: "member_token_invalid", message: "Member token is invalid." };
    }

    if (room.memberTokens.get(session.id) !== session.memberToken) {
      logEvent("auth_failed", {
        sessionId: session.id,
        roomCode: room.code,
        remoteAddress: session.remoteAddress,
        origin: session.origin,
        messageType,
        result: "rejected",
        reason: "member_token_session_mismatch"
      });
      return { ok: false, code: "member_token_invalid", message: "Member token is invalid." };
    }

    return { ok: true, room };
  }

  function handleRateLimitedMessage(session: Session, messageType: string): void {
    logEvent("rate_limited", {
      sessionId: session.id,
      roomCode: session.roomCode,
      remoteAddress: session.remoteAddress,
      origin: session.origin,
      messageType,
      result: "rejected"
    });
  }

  function handleClientMessage(session: Session, message: ClientMessage): void {
    const currentTime = now();

    switch (message.type) {
      case "room:create": {
        if (!consumeFixedWindow(session.rateLimitState.roomCreate, config.rateLimits.roomCreatePerMinute, WINDOW_MINUTE_MS, currentTime)) {
          handleRateLimitedMessage(session, message.type);
          sendError(session.socket, "rate_limited", "Too many requests.");
          return;
        }

        session.displayName = message.payload?.displayName?.trim() || session.displayName;
        const room = roomStore.createRoom();
        const memberToken = generateToken();
        joinRoom(session, room, memberToken);
        send(session.socket, {
          type: "room:created",
          payload: {
            roomCode: room.code,
            memberId: session.id,
            joinToken: room.joinToken,
            memberToken
          }
        });
        broadcastRoomState(room);
        logEvent("room_created", {
          sessionId: session.id,
          roomCode: room.code,
          remoteAddress: session.remoteAddress,
          origin: session.origin,
          result: "ok"
        });
        return;
      }
      case "room:join": {
        if (!consumeFixedWindow(session.rateLimitState.roomJoin, config.rateLimits.roomJoinPerMinute, WINDOW_MINUTE_MS, currentTime)) {
          handleRateLimitedMessage(session, message.type);
          sendError(session.socket, "rate_limited", "Too many requests.");
          return;
        }

        session.displayName = message.payload.displayName?.trim() || session.displayName;
        const room = roomStore.getRoom(message.payload.roomCode);
        if (!room) {
          sendError(session.socket, "room_not_found", "Room not found.");
          return;
        }
        if (room.joinToken !== message.payload.joinToken) {
          logEvent("auth_failed", {
            sessionId: session.id,
            roomCode: message.payload.roomCode,
            remoteAddress: session.remoteAddress,
            origin: session.origin,
            messageType: message.type,
            result: "rejected",
            reason: "join_token_invalid"
          });
          sendError(session.socket, "join_token_invalid", "Join token is invalid.");
          return;
        }
        if (room.members.size >= config.maxMembersPerRoom) {
          sendError(session.socket, "room_full", "Room is full.");
          return;
        }

        const memberToken = generateToken();
        joinRoom(session, room, memberToken);
        send(session.socket, {
          type: "room:joined",
          payload: {
            roomCode: room.code,
            memberId: session.id,
            memberToken
          }
        });
        broadcastRoomState(room);
        logEvent("room_joined", {
          sessionId: session.id,
          roomCode: room.code,
          remoteAddress: session.remoteAddress,
          origin: session.origin,
          result: "ok"
        });
        return;
      }
      case "room:leave": {
        if (message.payload?.memberToken && session.memberToken && message.payload.memberToken !== session.memberToken) {
          sendError(session.socket, "member_token_invalid", "Member token is invalid.");
          return;
        }
        leaveRoom(session);
        return;
      }
      case "video:share": {
        if (!consumeFixedWindow(session.rateLimitState.videoShare, config.rateLimits.videoSharePer10Seconds, WINDOW_10_SECONDS_MS, currentTime)) {
          handleRateLimitedMessage(session, message.type);
          sendError(session.socket, "rate_limited", "Too many requests.");
          return;
        }

        const access = requireJoinedRoomSession(session, message.type, message.payload.memberToken);
        if (!access.ok) {
          sendError(session.socket, access.code, access.message);
          return;
        }

        access.room.sharedVideo = {
          ...message.payload.video,
          sharedByMemberId: session.id
        };
        access.room.playback = {
          url: message.payload.video.url,
          currentTime: 0,
          playState: "paused",
          playbackRate: 1,
          updatedAt: currentTime,
          serverTime: currentTime,
          actorId: session.id,
          seq: 0
        };
        broadcastRoomState(access.room);
        return;
      }
      case "playback:update": {
        if (
          !consumeTokenBucket(
            session.rateLimitState.playbackUpdate,
            config.rateLimits.playbackUpdatePerSecond,
            config.rateLimits.playbackUpdateBurst,
            currentTime
          )
        ) {
          handleRateLimitedMessage(session, message.type);
          return;
        }

        const access = requireJoinedRoomSession(session, message.type, message.payload.memberToken);
        if (!access.ok) {
          sendError(session.socket, access.code, access.message);
          return;
        }
        if (!access.room.sharedVideo) {
          sendError(session.socket, "invalid_message", "No shared video exists for this room.");
          return;
        }
        const sharedUrl = normalizeBilibiliUrl(access.room.sharedVideo.url);
        const playbackUrl = normalizeBilibiliUrl(message.payload.playback.url);
        if (!sharedUrl || !playbackUrl || sharedUrl !== playbackUrl) {
          sendError(session.socket, "invalid_message", "Playback URL does not match the shared video.");
          return;
        }

        const nextPlayback: PlaybackState = {
          ...message.payload.playback,
          actorId: session.id,
          serverTime: currentTime
        };
        if (shouldIgnorePlaybackUpdate(access.room, nextPlayback, currentTime)) {
          return;
        }

        access.room.playback = nextPlayback;
        broadcastRoomState(access.room);
        return;
      }
      case "sync:request": {
        if (!consumeFixedWindow(session.rateLimitState.syncRequest, config.rateLimits.syncRequestPer10Seconds, WINDOW_10_SECONDS_MS, currentTime)) {
          handleRateLimitedMessage(session, message.type);
          sendError(session.socket, "rate_limited", "Too many requests.");
          return;
        }

        const access = requireJoinedRoomSession(session, message.type, message.payload.memberToken);
        if (!access.ok) {
          sendError(session.socket, access.code, access.message);
          return;
        }

        send(session.socket, {
          type: "room:state",
          payload: roomStateOf(access.room)
        });
        return;
      }
      case "sync:ping": {
        if (
          !consumeTokenBucket(
            session.rateLimitState.syncPing,
            config.rateLimits.syncPingPerSecond,
            config.rateLimits.syncPingBurst,
            currentTime
          )
        ) {
          handleRateLimitedMessage(session, message.type);
          return;
        }

        send(session.socket, {
          type: "sync:pong",
          payload: {
            clientSendTime: message.payload.clientSendTime,
            serverReceiveTime: currentTime,
            serverSendTime: now()
          }
        });
        return;
      }
      default: {
        const exhaustiveCheck: never = message;
        return exhaustiveCheck;
      }
    }
  }

  return {
    handleClientMessage,
    leaveRoom
  };
}
