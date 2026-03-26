import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createGlobalAdminServer } from "../src/global-admin-app.js";
import {
  getDefaultPersistenceConfig,
  getDefaultSecurityConfig,
} from "../src/app.js";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function requestJson(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

test("global admin server starts without websocket runtime and serves admin endpoints", async () => {
  const server = await createGlobalAdminServer(
    getDefaultSecurityConfig(),
    getDefaultPersistenceConfig(),
    {
      adminConfig: {
        username: "admin",
        passwordHash: `sha256:${sha256Hex("secret-123")}`,
        sessionSecret: "session-secret-123",
        sessionTtlMs: 60_000,
        role: "admin",
        sessionStoreProvider: "memory",
        eventStoreProvider: "memory",
        auditStoreProvider: "memory",
      },
      serviceVersion: "0.7.0-global-admin-test",
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.httpServer.listen(0, "127.0.0.1", () => resolve());
    server.httpServer.once("error", reject);
  });

  const address = server.httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine test server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const adminHtml = await fetch(`${baseUrl}/admin`);
    assert.equal(adminHtml.status, 200);
    assert.equal(
      adminHtml.headers.get("content-type")?.includes("text/html"),
      true,
    );

    const login = await requestJson(baseUrl, "/api/admin/auth/login", {
      method: "POST",
      body: { username: "admin", password: "secret-123" },
    });
    assert.equal(login.status, 200);
    const token = (login.body.data as { token: string }).token;
    assert.ok(token);

    const overview = await requestJson(baseUrl, "/api/admin/overview", {
      token,
    });
    assert.equal(overview.status, 200);
    assert.equal(
      (overview.body.data as { service: { name: string } }).service.name,
      "bili-syncplay-server",
    );

    const health = await requestJson(baseUrl, "/healthz");
    assert.equal(health.status, 200);
    assert.equal((health.body.data as { status: string }).status, "healthy");
  } finally {
    await server.close();
  }
});
