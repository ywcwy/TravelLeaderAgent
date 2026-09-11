import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig } from "../src/runtime-config.ts";
import { TravelLeaderRuntime } from "../src/runtime.ts";

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
