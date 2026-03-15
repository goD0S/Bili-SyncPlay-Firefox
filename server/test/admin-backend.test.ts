import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { WebSocket, type RawData } from "ws";
import { createSyncServer, getDefaultPersistenceConfig, getDefaultSecurityConfig, type SyncServerDependencies } from "../src/app.js";

const ALLOWED_ORIGIN = "chrome-extension://allowed-extension";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function startAdminServer(dependencies: SyncServerDependencies = {}) {
  const server = await createSyncServer(
    {
      ...getDefaultSecurityConfig(),
      allowedOrigins: [ALLOWED_ORIGIN]
    },
    getDefaultPersistenceConfig(),
    {
      ...dependencies,
      adminConfig: dependencies.adminConfig ?? {
        username: "admin",
        passwordHash: `sha256:${sha256Hex("secret-123")}`,
        sessionSecret: "session-secret-123",
        sessionTtlMs: 60_000,
        role: "admin"
      },
      serviceVersion: "0.7.0-test"
    }
  );

  await new Promise<void>((resolve, reject) => {
    server.httpServer.listen(0, "127.0.0.1", () => resolve());
    server.httpServer.once("error", reject);
  });

  const address = server.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine test server address.");
  }

  return {
    close: server.close,
    httpBaseUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}`
  };
}

async function requestJson(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>
  };
}

async function connectClient(wsUrl: string): Promise<WebSocket> {
  const socket = new WebSocket(wsUrl, { origin: ALLOWED_ORIGIN });
  await once(socket, "open");
  return socket;
}

function createMessageCollector(socket: WebSocket) {
  const queuedMessages: Array<Record<string, unknown>> = [];
  socket.on("message", (raw: RawData) => {
    queuedMessages.push(JSON.parse(raw.toString()) as Record<string, unknown>);
  });

  return {
    async next(type: string, timeoutMs = 2_000) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const index = queuedMessages.findIndex((message) => message.type === type);
        if (index >= 0) {
          return queuedMessages.splice(index, 1)[0] as Record<string, unknown>;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for message type ${type}`);
    }
  };
}

async function closeClient(socket: WebSocket): Promise<void> {
  socket.terminate();
}

test("admin endpoints support auth, overview, rooms, and events without breaking root health routes", async () => {
  const server = await startAdminServer();

  try {
    const root = await requestJson(server.httpBaseUrl, "/");
    assert.equal(root.status, 200);
    assert.equal(root.body.ok, true);

    const health = await requestJson(server.httpBaseUrl, "/healthz");
    assert.equal(health.status, 200);
    assert.equal((health.body.data as { status: string }).status, "healthy");

    const ready = await requestJson(server.httpBaseUrl, "/readyz");
    assert.equal(ready.status, 200);
    assert.equal((ready.body.data as { status: string }).status, "ready");

    const unauthorized = await requestJson(server.httpBaseUrl, "/api/admin/me");
    assert.equal(unauthorized.status, 401);

    const login = await requestJson(server.httpBaseUrl, "/api/admin/auth/login", {
      method: "POST",
      body: { username: "admin", password: "secret-123" }
    });
    assert.equal(login.status, 200);
    const token = ((login.body.data as { token: string }).token);
    assert.ok(token);

    const me = await requestJson(server.httpBaseUrl, "/api/admin/me", { token });
    assert.equal(me.status, 200);
    assert.equal((me.body.data as { username: string }).username, "admin");

    const socket = await connectClient(server.wsUrl);
    const collector = createMessageCollector(socket);
    try {
      socket.send(JSON.stringify({ type: "room:create", payload: { displayName: "Alice" } }));
      const created = await collector.next("room:created");
      await collector.next("room:state");
      const roomCode = ((created.payload as { roomCode: string }).roomCode);

      const overview = await requestJson(server.httpBaseUrl, "/api/admin/overview", { token });
      assert.equal(overview.status, 200);
      const overviewData = overview.body.data as {
        runtime: { connectionCount: number; activeRoomCount: number; activeMemberCount: number };
        rooms: { totalNonExpired: number };
      };
      assert.equal(overviewData.runtime.connectionCount, 1);
      assert.equal(overviewData.runtime.activeRoomCount, 1);
      assert.equal(overviewData.runtime.activeMemberCount, 1);
      assert.equal(overviewData.rooms.totalNonExpired, 1);

      const rooms = await requestJson(server.httpBaseUrl, "/api/admin/rooms?status=active&page=1&pageSize=10", { token });
      assert.equal(rooms.status, 200);
      const roomItems = (rooms.body.data as { items: Array<{ roomCode: string; memberCount: number; isActive: boolean }> }).items;
      assert.equal(roomItems.length, 1);
      assert.equal(roomItems[0]?.roomCode, roomCode);
      assert.equal(roomItems[0]?.memberCount, 1);
      assert.equal(roomItems[0]?.isActive, true);

      const detail = await requestJson(server.httpBaseUrl, `/api/admin/rooms/${roomCode}`, { token });
      assert.equal(detail.status, 200);
      const detailData = detail.body.data as {
        members: Array<{ displayName: string }>;
        recentEvents: Array<{ event: string }>;
      };
      assert.equal(detailData.members[0]?.displayName, "Alice");
      assert.equal(detailData.recentEvents.some((event) => event.event === "room_created"), true);

      const events = await requestJson(server.httpBaseUrl, `/api/admin/events?event=room_created&roomCode=${roomCode}`, { token });
      assert.equal(events.status, 200);
      const eventItems = (events.body.data as { items: Array<{ event: string; roomCode: string }> }).items;
      assert.equal(eventItems.length, 1);
      assert.equal(eventItems[0]?.event, "room_created");
      assert.equal(eventItems[0]?.roomCode, roomCode);
    } finally {
      await closeClient(socket);
    }

    const logout = await requestJson(server.httpBaseUrl, "/api/admin/auth/logout", {
      method: "POST",
      token
    });
    assert.equal(logout.status, 200);

    const meAfterLogout = await requestJson(server.httpBaseUrl, "/api/admin/me", { token });
    assert.equal(meAfterLogout.status, 401);
  } finally {
    await server.close();
  }
});

test("admin login rejects invalid credentials", async () => {
  const server = await startAdminServer();

  try {
    const login = await requestJson(server.httpBaseUrl, "/api/admin/auth/login", {
      method: "POST",
      body: { username: "admin", password: "wrong-password" }
    });
    assert.equal(login.status, 401);
    assert.equal(login.body.ok, false);
  } finally {
    await server.close();
  }
});
