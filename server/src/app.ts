import { createServer, type Server as HttpServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { isClientMessage, type ErrorCode, type ServerMessage } from "@bili-syncplay/protocol";
import { createStructuredLogger } from "./logger";
import { createMessageHandler } from "./message-handler";
import { createSessionRateLimitState } from "./rate-limit";
import { createInMemoryRoomStore } from "./room-store";
import { createSecurityPolicy } from "./security";
import type { SecurityConfig, Session } from "./types";

export type { SecurityConfig } from "./types";

export const INVALID_JSON_MESSAGE = "Invalid JSON message.";
export const INVALID_CLIENT_MESSAGE_MESSAGE = "Invalid client message payload.";
export const INTERNAL_SERVER_ERROR_MESSAGE = "Internal server error.";

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
  const roomStore = createInMemoryRoomStore({ generateToken });
  const logEvent = createStructuredLogger();
  const securityPolicy = createSecurityPolicy(config);

  const httpServer = createServer((_, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "bili-syncplay-server" }));
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxMessageBytes
  });

  const messageHandler = createMessageHandler({
    config,
    roomStore,
    logEvent,
    send,
    sendError,
    generateToken
  });

  function generateToken(): string {
    return randomBytes(24).toString("base64url");
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
    const decision = securityPolicy.evaluateUpgrade(request);
    if (!decision.ok) {
      rejectUpgrade(socket, decision.statusCode, decision.statusText, {
        remoteAddress: decision.context.remoteAddress,
        origin: decision.context.origin,
        result: "rejected",
        reason: decision.reason
      });
      return;
    }

    request.biliSyncPlayContext = decision.context;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket, request) => {
    const context = request.biliSyncPlayContext ?? {
      remoteAddress: securityPolicy.getRemoteAddress(request),
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
      rateLimitState: createSessionRateLimitState(config)
    };

    securityPolicy.incrementConnectionCount(session.remoteAddress);
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
        messageHandler.handleClientMessage(session, parsed);
      } catch (error) {
        console.error("Unhandled client message error", error);
        sendError(socket, "internal_error", INTERNAL_SERVER_ERROR_MESSAGE);
      }
    });

    socket.on("close", () => {
      securityPolicy.decrementConnectionCount(session.remoteAddress);
      messageHandler.leaveRoom(session);
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
