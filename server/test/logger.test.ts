import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredLogger } from "../src/logger.js";
import { createInMemoryRuntimeStore } from "../src/runtime-store.js";

test("structured logger excludes successful node heartbeats from event storage", async () => {
  const writtenLines: string[] = [];
  const appendedEvents: Array<{
    event: string;
    timestamp?: string;
    data: Record<string, unknown>;
  }> = [];
  const runtimeStore = createInMemoryRuntimeStore(() => 0);
  const logger = createStructuredLogger(
    (line) => {
      writtenLines.push(line);
    },
    {
      append(input) {
        appendedEvents.push(input);
        return Promise.resolve({
          id: "evt-1",
          timestamp: input.timestamp ?? new Date().toISOString(),
          event: input.event,
          roomCode: null,
          sessionId: null,
          remoteAddress: null,
          origin: null,
          result: null,
          details: input.data,
        });
      },
      query() {
        throw new Error("query should not be called in this test");
      },
    },
    runtimeStore,
  );

  logger("node_heartbeat_sent", { instanceId: "node-1", result: "ok" });
  logger("room_created", { roomCode: "ROOM01", result: "ok" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(writtenLines.length, 2);
  assert.equal(appendedEvents.length, 1);
  assert.equal(appendedEvents[0]?.event, "room_created");
  assert.deepEqual(Object.keys(runtimeStore.getLifetimeEventCounts()), [
    "node_heartbeat_sent",
    "room_created",
  ]);
});
