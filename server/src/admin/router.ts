import type { IncomingMessage, ServerResponse } from "node:http";
import { getBearerToken, getPathSegments, getQueryParams, JsonBodyParseError, readJsonBody, parsePositiveInt } from "./request.js";
import { sendError, sendOk } from "./response.js";
import type { AdminAuthService } from "./auth-service.js";
import type { EventStore } from "./event-store.js";
import type { AdminSession, EventListQuery, RoomListQuery } from "./types.js";

function unauthorized(response: ServerResponse): void {
  sendError(response, 401, "unauthorized", "未授权。");
}

export function createAdminRouter(options: {
  authService?: AdminAuthService;
  roomStoreReady: () => Promise<boolean>;
  getOverview: () => Promise<unknown>;
  listRooms: (query: RoomListQuery) => Promise<unknown>;
  getRoomDetail: (roomCode: string) => Promise<unknown | null>;
  eventStore: EventStore;
  serviceName: string;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;

  async function requireAdmin(request: IncomingMessage, response: ServerResponse): Promise<AdminSession | null> {
    const token = getBearerToken(request);
    if (!token || !options.authService) {
      unauthorized(response);
      return null;
    }
    const session = await options.authService.authenticate(token);
    if (!session) {
      unauthorized(response);
      return null;
    }
    return session;
  }

  return {
    async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

      try {
        if (request.method === "GET" && pathname === "/healthz") {
          sendOk(response, {
            status: "healthy",
            service: options.serviceName,
            time: new Date(now()).toISOString()
          });
          return true;
        }

        if (request.method === "GET" && pathname === "/readyz") {
          const roomStoreReady = await options.roomStoreReady();
          const status = roomStoreReady ? "ready" : "not_ready";
          sendOk(response, {
            status,
            checks: {
              httpServer: "ok",
              roomStore: roomStoreReady ? "ok" : "error",
              redis: roomStoreReady ? "ok" : "error"
            }
          }, roomStoreReady ? 200 : 503);
          return true;
        }

        if (request.method === "POST" && pathname === "/api/admin/auth/login") {
          if (!options.authService) {
            sendError(response, 503, "admin_auth_unavailable", "管理后台认证未配置。");
            return true;
          }
          const body = await readJsonBody<{ username?: string; password?: string }>(request);
          const username = body.username?.trim() ?? "";
          const password = body.password ?? "";
          try {
            const result = await options.authService.login(username, password);
            sendOk(response, {
              token: result.token,
              expiresAt: result.expiresAt,
              admin: {
                id: result.admin.adminId,
                username: result.admin.username,
                role: result.admin.role
              }
            });
          } catch {
            sendError(response, 401, "invalid_credentials", "用户名或密码错误。");
          }
          return true;
        }

        if (request.method === "POST" && pathname === "/api/admin/auth/logout") {
          const token = getBearerToken(request);
          if (!token || !options.authService) {
            unauthorized(response);
            return true;
          }
          await options.authService.logout(token);
          sendOk(response, { success: true });
          return true;
        }

        if (request.method === "GET" && pathname === "/api/admin/me") {
          const session = await requireAdmin(request, response);
          if (!session) {
            return true;
          }
          sendOk(response, {
            id: session.adminId,
            username: session.username,
            role: session.role,
            expiresAt: session.expiresAt,
            lastSeenAt: session.lastSeenAt
          });
          return true;
        }

        if (request.method === "GET" && pathname === "/api/admin/overview") {
          const session = await requireAdmin(request, response);
          if (!session) {
            return true;
          }
          sendOk(response, await options.getOverview());
          return true;
        }

        if (request.method === "GET" && pathname === "/api/admin/rooms") {
          const session = await requireAdmin(request, response);
          if (!session) {
            return true;
          }
          const queryParams = getQueryParams(request);
          const status = queryParams.get("status");
          const query: RoomListQuery = {
            status: status === "active" || status === "idle" || status === "all" ? status : "all",
            keyword: queryParams.get("keyword") ?? undefined,
            page: parsePositiveInt(queryParams.get("page"), 1),
            pageSize: Math.min(parsePositiveInt(queryParams.get("pageSize"), 20), 100),
            sortBy: queryParams.get("sortBy") === "createdAt" ? "createdAt" : "lastActiveAt",
            sortOrder: queryParams.get("sortOrder") === "asc" ? "asc" : "desc",
            includeExpired: queryParams.get("includeExpired") === "true"
          };
          sendOk(response, await options.listRooms(query));
          return true;
        }

        const segments = getPathSegments(request);
        if (request.method === "GET" && segments.length === 4 && segments[0] === "api" && segments[1] === "admin" && segments[2] === "rooms") {
          const session = await requireAdmin(request, response);
          if (!session) {
            return true;
          }
          const detail = await options.getRoomDetail(segments[3] ?? "");
          if (!detail) {
            sendError(response, 404, "room_not_found", "房间不存在。");
            return true;
          }
          sendOk(response, detail);
          return true;
        }

        if (request.method === "GET" && pathname === "/api/admin/events") {
          const session = await requireAdmin(request, response);
          if (!session) {
            return true;
          }
          const queryParams = getQueryParams(request);
          const query: EventListQuery = {
            event: queryParams.get("event") ?? undefined,
            roomCode: queryParams.get("roomCode") ?? undefined,
            sessionId: queryParams.get("sessionId") ?? undefined,
            remoteAddress: queryParams.get("remoteAddress") ?? undefined,
            origin: queryParams.get("origin") ?? undefined,
            result: queryParams.get("result") ?? undefined,
            from: queryParams.get("from") ? Number(queryParams.get("from")) : undefined,
            to: queryParams.get("to") ? Number(queryParams.get("to")) : undefined,
            page: parsePositiveInt(queryParams.get("page"), 1),
            pageSize: Math.min(parsePositiveInt(queryParams.get("pageSize"), 20), 100)
          };
          sendOk(response, {
            ...options.eventStore.query(query),
            pagination: {
              page: query.page,
              pageSize: query.pageSize
            }
          });
          return true;
        }

        return false;
      } catch (error) {
        if (error instanceof JsonBodyParseError) {
          sendError(response, 400, "invalid_json", error.message);
          return true;
        }
        sendError(response, 500, "internal_error", "服务器内部错误。");
        return true;
      }
    }
  };
}
