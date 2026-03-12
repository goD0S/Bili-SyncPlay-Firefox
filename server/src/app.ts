import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import {
  isClientMessage,
  type ClientMessage,
  type ErrorCode,
  type PlaybackState,
  type RoomState,
  type ServerMessage,
  type SharedVideo
} from "@bili-syncplay/protocol";

type WindowCounter = {
  windowStart: number;
  count: number;
};

type TokenBucket = {
  tokens: number;
  lastRefillAt: number;
};

type SessionRateLimitState = {
  roomCreate: WindowCounter;
  roomJoin: WindowCounter;
  videoShare: WindowCounter;
  syncRequest: WindowCounter;
  playbackUpdate: TokenBucket;
  syncPing: TokenBucket;
};

type Session = {
  id: string;
  socket: WebSocket;
  remoteAddress: string | null;
  origin: string | null;
  roomCode: string | null;
  displayName: string;
  memberToken: string | null;
  joinedAt: number | null;
  invalidMessageCount: number;
  rateLimitState: SessionRateLimitState;
};

type Room = {
  code: string;
  joinToken: string;
  createdAt: number;
  sharedVideo: SharedVideo | null;
  playback: PlaybackState | null;
  members: Map<string, Session>;
  memberTokens: Map<string, string>;
};

type RequestContext = {
  remoteAddress: string | null;
  origin: string | null;
};

export type SecurityConfig = {
  allowedOrigins: string[];
  allowMissingOriginInDev: boolean;
  trustProxyHeaders: boolean;
  maxConnectionsPerIp: number;
  connectionAttemptsPerMinute: number;
  maxMembersPerRoom: number;
  maxMessageBytes: number;
  invalidMessageCloseThreshold: number;
  rateLimits: {
    roomCreatePerMinute: number;
    roomJoinPerMinute: number;
    videoSharePer10Seconds: number;
    playbackUpdatePerSecond: number;
    playbackUpdateBurst: number;
    syncRequestPer10Seconds: number;
    syncPingPerSecond: number;
    syncPingBurst: number;
  };
};

declare module "node:http" {
  interface IncomingMessage {
    biliSyncPlayContext?: RequestContext;
  }
}

export const INVALID_JSON_MESSAGE = "Invalid JSON message.";
export const INVALID_CLIENT_MESSAGE_MESSAGE = "Invalid client message payload.";
export const INTERNAL_SERVER_ERROR_MESSAGE = "Internal server error.";

const PAUSE_DOMINANCE_WINDOW_MS = 400;
const WINDOW_MINUTE_MS = 60_000;
const WINDOW_10_SECONDS_MS = 10_000;
const CLOSE_CODE_POLICY_VIOLATION = 1008;

export type SyncServer = {
  httpServer: HttpServer;
  close: () => Promise<void>;
};

export function getDefaultSecurityConfig(): SecurityConfig {
  return {
    allowedOrigins: [],
    allowMissingOriginInDev: false,
    trustProxyHeaders: false,
    maxConnectionsPerIp: 10,
    connectionAttemptsPerMinute: 20,
    maxMembersPerRoom: 8,
    maxMessageBytes: 8 * 1024,
    invalidMessageCloseThreshold: 3,
    rateLimits: {
      roomCreatePerMinute: 3,
      roomJoinPerMinute: 10,
      videoSharePer10Seconds: 3,
      playbackUpdatePerSecond: 8,
      playbackUpdateBurst: 12,
      syncRequestPer10Seconds: 6,
      syncPingPerSecond: 1,
      syncPingBurst: 2
    }
  };
}

export function createSyncServer(config: SecurityConfig = getDefaultSecurityConfig()): SyncServer {
  const rooms = new Map<string, Room>();
  const ipAttemptWindows = new Map<string, WindowCounter>();
  const ipConnectionCounts = new Map<string, number>();

  const httpServer = createServer((_, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "bili-syncplay-server" }));
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxMessageBytes
  });

  function logEvent(event: string, data: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        ...data
      })
    );
  }

  function createWindowCounter(): WindowCounter {
    return { windowStart: Date.now(), count: 0 };
  }

  function createTokenBucket(capacity: number): TokenBucket {
    return {
      tokens: capacity,
      lastRefillAt: Date.now()
    };
  }

  function createRateLimitState(): SessionRateLimitState {
    return {
      roomCreate: createWindowCounter(),
      roomJoin: createWindowCounter(),
      videoShare: createWindowCounter(),
      syncRequest: createWindowCounter(),
      playbackUpdate: createTokenBucket(config.rateLimits.playbackUpdateBurst),
      syncPing: createTokenBucket(config.rateLimits.syncPingBurst)
    };
  }

  function createRoomCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  }

  function generateToken(): string {
    return randomBytes(24).toString("base64url");
  }

  function roomStateOf(room: Room): RoomState {
    return {
      roomCode: room.code,
      sharedVideo: room.sharedVideo,
      playback: room.playback,
      members: Array.from(room.members.values()).map((member) => ({
        id: member.id,
        name: member.displayName
      }))
    };
  }

  function parseBilibiliVideoRef(url: string | undefined | null): { videoId: string; normalizedUrl: string } | null {
    if (!url) {
      return null;
    }

    try {
      const parsed = new URL(url);
      const bvid = parsed.searchParams.get("bvid");
      if (bvid) {
        const cid = parsed.searchParams.get("cid");
        const p = parsed.searchParams.get("p");
        return {
          videoId: cid ? `${bvid}:${cid}` : p ? `${bvid}:p${p}` : bvid,
          normalizedUrl: cid
            ? `https://www.bilibili.com/video/${bvid}?cid=${cid}`
            : p
              ? `https://www.bilibili.com/video/${bvid}?p=${p}`
              : `https://www.bilibili.com/video/${bvid}`
        };
      }

      const pathname = parsed.pathname.replace(/\/+$/, "");
      const match = pathname.match(/^\/(?:video|bangumi\/play)\/([^/?]+)$/);
      if (!match) {
        return null;
      }

      const p = parsed.searchParams.get("p");
      return {
        videoId: p ? `${match[1]}:p${p}` : match[1],
        normalizedUrl: p ? `${parsed.origin}${pathname}?p=${p}` : `${parsed.origin}${pathname}`
      };
    } catch {
      return null;
    }
  }

  function normalizeUrl(url: string | undefined | null): string | null {
    return parseBilibiliVideoRef(url)?.normalizedUrl ?? null;
  }

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
    send(socket, {
      type: "error",
      payload: { code, message }
    });
  }

  function parseIncomingMessage(raw: RawData): unknown {
    return JSON.parse(raw.toString()) as unknown;
  }

  function broadcastRoomState(room: Room): void {
    const message: ServerMessage = {
      type: "room:state",
      payload: roomStateOf(room)
    };

    for (const member of room.members.values()) {
      send(member.socket, message);
    }
  }

  function createUniqueRoom(): Room {
    let roomCode = createRoomCode();
    while (rooms.has(roomCode)) {
      roomCode = createRoomCode();
    }

    const room: Room = {
      code: roomCode,
      joinToken: generateToken(),
      createdAt: Date.now(),
      sharedVideo: null,
      playback: null,
      members: new Map(),
      memberTokens: new Map()
    };
    rooms.set(roomCode, room);
    return room;
  }

  function incrementConnectionCount(remoteAddress: string | null): void {
    if (!remoteAddress) {
      return;
    }
    ipConnectionCounts.set(remoteAddress, (ipConnectionCounts.get(remoteAddress) ?? 0) + 1);
  }

  function decrementConnectionCount(remoteAddress: string | null): void {
    if (!remoteAddress) {
      return;
    }
    const nextValue = (ipConnectionCounts.get(remoteAddress) ?? 1) - 1;
    if (nextValue <= 0) {
      ipConnectionCounts.delete(remoteAddress);
      return;
    }
    ipConnectionCounts.set(remoteAddress, nextValue);
  }

  function leaveRoom(session: Session): void {
    if (!session.roomCode) {
      return;
    }

    const room = rooms.get(session.roomCode);
    session.roomCode = null;
    session.memberToken = null;
    session.joinedAt = null;

    if (!room) {
      return;
    }

    room.members.delete(session.id);
    room.memberTokens.delete(session.id);

    if (room.members.size === 0) {
      rooms.delete(room.code);
      return;
    }

    broadcastRoomState(room);
    logEvent("room_left", {
      sessionId: session.id,
      roomCode: room.code,
      remoteAddress: session.remoteAddress,
      origin: session.origin,
      result: "ok"
    });
  }

  function joinRoom(session: Session, room: Room, memberToken: string): Room {
    leaveRoom(session);
    room.members.set(session.id, session);
    room.memberTokens.set(session.id, memberToken);
    session.roomCode = room.code;
    session.memberToken = memberToken;
    session.joinedAt = Date.now();
    return room;
  }

  function shouldIgnorePlaybackUpdate(room: Room, nextPlayback: PlaybackState, now: number): boolean {
    if (!room.playback) {
      return false;
    }

    const currentPlayback = room.playback;
    if (currentPlayback.actorId === nextPlayback.actorId) {
      return false;
    }
    const currentIsStopLike = currentPlayback.playState === "paused" || currentPlayback.playState === "buffering";
    const nextIsPlaying = nextPlayback.playState === "playing";
    const withinPauseWindow = now - currentPlayback.serverTime < PAUSE_DOMINANCE_WINDOW_MS;
    const closeInTimeline = Math.abs(nextPlayback.currentTime - currentPlayback.currentTime) < 1.2;

    return currentIsStopLike && nextIsPlaying && withinPauseWindow && closeInTimeline;
  }

  function consumeFixedWindow(counter: WindowCounter, limit: number, windowMs: number, now: number): boolean {
    if (now - counter.windowStart >= windowMs) {
      counter.windowStart = now;
      counter.count = 0;
    }

    if (counter.count >= limit) {
      return false;
    }

    counter.count += 1;
    return true;
  }

  function consumeTokenBucket(bucket: TokenBucket, refillPerSecond: number, capacity: number, now: number): boolean {
    const elapsedMs = Math.max(0, now - bucket.lastRefillAt);
    const refill = elapsedMs / 1000 * refillPerSecond;
    bucket.tokens = Math.min(capacity, bucket.tokens + refill);
    bucket.lastRefillAt = now;

    if (bucket.tokens < 1) {
      return false;
    }

    bucket.tokens -= 1;
    return true;
  }

  function countInvalidMessage(session: Session, reason: string): void {
    session.invalidMessageCount += 1;
    logEvent("invalid_message", {
      sessionId: session.id,
      roomCode: session.roomCode,
      remoteAddress: session.remoteAddress,
      origin: session.origin,
      result: "rejected",
      reason,
      invalidMessageCount: session.invalidMessageCount
    });

    if (session.invalidMessageCount >= config.invalidMessageCloseThreshold) {
      session.socket.close(CLOSE_CODE_POLICY_VIOLATION, "Too many invalid messages");
    }
  }

  function requireJoinedRoomSession(
    session: Session,
    messageType: ClientMessage["type"],
    memberToken: string | undefined
  ): { ok: true; room: Room } | { ok: false; code: ErrorCode; message: string } {
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

    const room = rooms.get(session.roomCode);
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
    const now = Date.now();

    switch (message.type) {
      case "room:create": {
        if (!consumeFixedWindow(session.rateLimitState.roomCreate, config.rateLimits.roomCreatePerMinute, WINDOW_MINUTE_MS, now)) {
          handleRateLimitedMessage(session, message.type);
          sendError(session.socket, "rate_limited", "Too many requests.");
          return;
        }

        session.displayName = message.payload?.displayName?.trim() || session.displayName;
        const room = createUniqueRoom();
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
        if (!consumeFixedWindow(session.rateLimitState.roomJoin, config.rateLimits.roomJoinPerMinute, WINDOW_MINUTE_MS, now)) {
          handleRateLimitedMessage(session, message.type);
          sendError(session.socket, "rate_limited", "Too many requests.");
          return;
        }

        session.displayName = message.payload.displayName?.trim() || session.displayName;
        const room = rooms.get(message.payload.roomCode);
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
        if (!consumeFixedWindow(session.rateLimitState.videoShare, config.rateLimits.videoSharePer10Seconds, WINDOW_10_SECONDS_MS, now)) {
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
          updatedAt: now,
          serverTime: now,
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
            now
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
        const sharedUrl = normalizeUrl(access.room.sharedVideo.url);
        const playbackUrl = normalizeUrl(message.payload.playback.url);
        if (!sharedUrl || !playbackUrl || sharedUrl !== playbackUrl) {
          sendError(session.socket, "invalid_message", "Playback URL does not match the shared video.");
          return;
        }

        const nextPlayback: PlaybackState = {
          ...message.payload.playback,
          actorId: session.id,
          serverTime: now
        };
        if (shouldIgnorePlaybackUpdate(access.room, nextPlayback, now)) {
          return;
        }

        access.room.playback = nextPlayback;
        broadcastRoomState(access.room);
        return;
      }
      case "sync:request": {
        if (!consumeFixedWindow(session.rateLimitState.syncRequest, config.rateLimits.syncRequestPer10Seconds, WINDOW_10_SECONDS_MS, now)) {
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
            now
          )
        ) {
          handleRateLimitedMessage(session, message.type);
          return;
        }

        send(session.socket, {
          type: "sync:pong",
          payload: {
            clientSendTime: message.payload.clientSendTime,
            serverReceiveTime: now,
            serverSendTime: Date.now()
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

  function getRemoteAddress(request: IncomingMessage): string | null {
    const forwarded = request.headers["x-forwarded-for"];
    if (config.trustProxyHeaders && typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0]?.trim() ?? null;
    }
    return request.socket.remoteAddress ?? null;
  }

  function isOriginAllowed(origin: string | null): { ok: true } | { ok: false; reason: string } {
    if (!origin) {
      if (config.allowMissingOriginInDev) {
        return { ok: true };
      }
      return { ok: false, reason: "origin_missing" };
    }

    if (config.allowedOrigins.includes(origin)) {
      return { ok: true };
    }

    return { ok: false, reason: "origin_not_allowed" };
  }

  function rejectUpgrade(
    socket: import("node:stream").Duplex,
    statusCode: number,
    statusText: string,
    details: Record<string, unknown>
  ): void {
    socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
    logEvent("ws_connection_rejected", details);
  }

  httpServer.on("upgrade", (request, socket, head) => {
    const originHeader = request.headers.origin;
    const origin = typeof originHeader === "string" ? originHeader : null;
    const remoteAddress = getRemoteAddress(request);
    const originCheck = isOriginAllowed(origin);

    if (!originCheck.ok) {
      rejectUpgrade(socket, 403, "Forbidden", {
        remoteAddress,
        origin,
        result: "rejected",
        reason: originCheck.reason
      });
      return;
    }

    const ipKey = remoteAddress ?? "unknown";
    const attemptWindow = ipAttemptWindows.get(ipKey) ?? createWindowCounter();
    ipAttemptWindows.set(ipKey, attemptWindow);
    if (!consumeFixedWindow(attemptWindow, config.connectionAttemptsPerMinute, WINDOW_MINUTE_MS, Date.now())) {
      rejectUpgrade(socket, 429, "Too Many Requests", {
        remoteAddress,
        origin,
        result: "rejected",
        reason: "connection_attempt_rate_limited"
      });
      return;
    }

    if ((ipConnectionCounts.get(ipKey) ?? 0) >= config.maxConnectionsPerIp) {
      rejectUpgrade(socket, 429, "Too Many Requests", {
        remoteAddress,
        origin,
        result: "rejected",
        reason: "connection_count_limited"
      });
      return;
    }

    request.biliSyncPlayContext = { remoteAddress, origin };
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket, request) => {
    const context = request.biliSyncPlayContext ?? {
      remoteAddress: getRemoteAddress(request),
      origin: typeof request.headers.origin === "string" ? request.headers.origin : null
    };
    const session: Session = {
      id: randomUUID(),
      socket,
      remoteAddress: context.remoteAddress,
      origin: context.origin,
      roomCode: null,
      displayName: `Guest-${Math.floor(Math.random() * 900 + 100)}`,
      memberToken: null,
      joinedAt: null,
      invalidMessageCount: 0,
      rateLimitState: createRateLimitState()
    };

    incrementConnectionCount(session.remoteAddress);
    logEvent("ws_connection_accepted", {
      sessionId: session.id,
      remoteAddress: session.remoteAddress,
      origin: session.origin,
      result: "ok"
    });

    socket.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = parseIncomingMessage(raw);
      } catch {
        sendError(socket, "invalid_message", INVALID_JSON_MESSAGE);
        countInvalidMessage(session, "invalid_json");
        return;
      }

      if (!isClientMessage(parsed)) {
        sendError(socket, "invalid_message", INVALID_CLIENT_MESSAGE_MESSAGE);
        countInvalidMessage(session, "invalid_client_message");
        return;
      }

      try {
        handleClientMessage(session, parsed);
      } catch (error) {
        console.error("Unhandled client message error", error);
        sendError(socket, "internal_error", INTERNAL_SERVER_ERROR_MESSAGE);
      }
    });

    socket.on("close", () => {
      decrementConnectionCount(session.remoteAddress);
      leaveRoom(session);
      logEvent("ws_connection_closed", {
        sessionId: session.id,
        remoteAddress: session.remoteAddress,
        origin: session.origin,
        roomCode: session.roomCode,
        result: "closed"
      });
    });
  });

  return {
    httpServer,
    close: () =>
      new Promise((resolve, reject) => {
        for (const client of wss.clients) {
          client.terminate();
        }
        wss.close((wsError) => {
          if (wsError) {
            reject(wsError);
            return;
          }
          httpServer.close((httpError) => {
            if (httpError) {
              reject(httpError);
              return;
            }
            resolve();
          });
        });
      })
  };
}
