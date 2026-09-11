import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig } from "../src/runtime-config.ts";
import { TravelLeaderRuntime } from "../src/runtime.ts";
import type { AcceptedLineEvent } from "../src/line-webhook-handler.ts";

const required = {
  LINE_CHANNEL_SECRET: "secret",
  LINE_CHANNEL_ACCESS_TOKEN: "access",
  LINE_OFFICIAL_ACCOUNT_USER_ID: "U-bot",
  TRAVEL_SYSTEM_ADMINISTRATOR_ID: "system-admin",
};

test("loads required runtime configuration without exposing secrets", () => {
  const config = loadRuntimeConfig({ ...required, TRAVEL_DATABASE_PATH: "./data/test.sqlite", PORT: "3100", WEBHOOK_BODY_LIMIT_BYTES: "128" });
  assert.deepEqual(config, { channelSecret: "secret", channelAccessToken: "access", officialAccountUserId: "U-bot", systemAdministratorId: "system-admin", databasePath: "./data/test.sqlite", port: 3100, bodyLimitBytes: 128, requestTimeoutMs: 10_000, workerPollMs: 1_000 });
});

test("fails fast and names missing variables without including secret values", () => {
  assert.throws(() => loadRuntimeConfig({ LINE_CHANNEL_SECRET: "secret" }), (error: unknown) => {
    assert.match(String(error), /LINE_CHANNEL_ACCESS_TOKEN/);
    assert.doesNotMatch(String(error), /secret/);
    return true;
  });
});

test("starts the provider-neutral runtime with an in-memory database", async () => {
  const runtime = new TravelLeaderRuntime({ ...loadRuntimeConfig({ ...required, TRAVEL_DATABASE_PATH: ":memory:", PORT: "0" }) });
  const address = await runtime.start();
  assert.equal(address.host, "0.0.0.0");
  await runtime.stop();
});

test("stops accepting HTTP before stopping the poller", async () => {
  let releasePoller!: () => void;
  let pollerStopping!: () => void;
  const stopStarted = new Promise<void>((resolve) => { pollerStopping = resolve; });
  const poller = { start: () => undefined, stop: () => new Promise<void>((resolve) => { pollerStopping(); releasePoller = resolve; }) };
  const runtime = new TravelLeaderRuntime(loadRuntimeConfig({ ...required, TRAVEL_DATABASE_PATH: ":memory:", PORT: "0" }), poller);
  const address = await runtime.start();
  const stopping = runtime.stop();
  await stopStarted;
  await assert.rejects(fetch(`http://${address.host}:${address.port}/healthz`));
  releasePoller();
  await stopping;
});

test("default runtime wires polling to Source creation and Reply API", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => { calls.push(String(input)); return new Response(null, { status: 200 }); }) as typeof fetch;
  const runtime = new TravelLeaderRuntime(loadRuntimeConfig({ ...required, TRAVEL_DATABASE_PATH: ":memory:", PORT: "0", TRAVEL_WORKER_POLL_MS: "1" }));
  try {
    const group = runtime.service.createTravelGroup("system-admin", "C-runtime", "Runtime 群組");
    const trip = runtime.service.createActiveTrip("system-admin", group.id, "Runtime 旅程", "Asia/Taipei");
    const event: AcceptedLineEvent = { eventId: "01JLINERUNTIME00000000000000", messageId: "message-runtime", groupId: group.lineGroupId, userId: "U-member", tripId: trip.id, text: "- [provisional] 住宿 | 2026-10-16 | 台北", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-runtime" };
    runtime.inbox.enqueue(event);
    await runtime.start();
    for (let attempt = 0; attempt < 100 && runtime.inbox.get(event.eventId)?.status !== "completed"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 2));
    assert.equal(runtime.inbox.get(event.eventId)?.status, "completed");
    assert.deepEqual(calls, ["https://api.line.me/v2/bot/message/reply"]);
    assert.equal(runtime.service.reviewTrip(trip.id).provisional.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await runtime.stop();
  }
});
