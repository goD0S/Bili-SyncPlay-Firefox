import type {
  AdminCommand,
  AdminCommandBus,
  AdminCommandResult,
} from "./admin-command-bus.js";
import type { LogEvent, Session } from "./types.js";

export async function createAdminCommandConsumer(options: {
  instanceId: string;
  adminCommandBus: AdminCommandBus;
  getLocalSession: (sessionId: string) => Session | null;
  listLocalSessionsByRoom: (roomCode: string) => Session[];
  blockMemberToken: (
    roomCode: string,
    memberToken: string,
    expiresAt: number,
  ) => void;
  disconnectSessionSocket: (session: Session, reason: string) => void;
  now?: () => number;
  logEvent?: LogEvent;
}): Promise<{ close: () => Promise<void> }> {
  const now = options.now ?? Date.now;

  async function handleCommand(
    command: AdminCommand,
  ): Promise<AdminCommandResult> {
    switch (command.kind) {
      case "disconnect_session": {
        const session = options.getLocalSession(command.sessionId);
        if (!session) {
          return {
            requestId: command.requestId,
            targetInstanceId: command.targetInstanceId,
            executorInstanceId: options.instanceId,
            status: "not_found",
            code: "session_not_found",
            message: "Session not found.",
            completedAt: now(),
          };
        }

        options.disconnectSessionSocket(session, "Admin disconnected session");
        options.logEvent?.("admin_command_executed", {
          commandType: command.kind,
          targetInstanceId: command.targetInstanceId,
          executorInstanceId: options.instanceId,
          sessionId: command.sessionId,
          result: "ok",
        });
        return {
          requestId: command.requestId,
          targetInstanceId: command.targetInstanceId,
          executorInstanceId: options.instanceId,
          status: "ok",
          roomCode: session.roomCode,
          sessionId: command.sessionId,
          completedAt: now(),
        };
      }
      case "kick_member": {
        const session = options
          .listLocalSessionsByRoom(command.roomCode)
          .find((entry) => entry.memberId === command.memberId);
        if (!session) {
          return {
            requestId: command.requestId,
            targetInstanceId: command.targetInstanceId,
            executorInstanceId: options.instanceId,
            status: "not_found",
            code: "member_not_found",
            message: "Member not found.",
            completedAt: now(),
          };
        }

        if (session.memberToken) {
          options.blockMemberToken(
            command.roomCode,
            session.memberToken,
            now() + 60_000,
          );
        }
        options.disconnectSessionSocket(session, "Admin kicked member");
        options.logEvent?.("admin_command_executed", {
          commandType: command.kind,
          targetInstanceId: command.targetInstanceId,
          executorInstanceId: options.instanceId,
          roomCode: command.roomCode,
          memberId: command.memberId,
          sessionId: session.id,
          result: "ok",
        });
        return {
          requestId: command.requestId,
          targetInstanceId: command.targetInstanceId,
          executorInstanceId: options.instanceId,
          status: "ok",
          roomCode: command.roomCode,
          memberId: command.memberId,
          sessionId: session.id,
          completedAt: now(),
        };
      }
    }
  }

  const unsubscribe = await options.adminCommandBus.subscribe(
    options.instanceId,
    handleCommand,
  );

  return {
    async close() {
      await unsubscribe();
    },
  };
}
