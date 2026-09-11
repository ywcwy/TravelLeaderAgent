import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { LineWebhookHttpServer } from "../src/line-webhook-server.ts";
import type { LineWebhookRequest, LineWebhookResponse } from "../src/line-webhook-handler.ts";

async function listen(server: LineWebhookHttpServer): Promise<string> {
  const address = await server.start(0, "127.0.0.1");
  return `http://${address.host}:${address.port}`;
}

test("serves health and forwards the raw webhook request", async () => {
  const requests: LineWebhookRequest[] = [];
  const server = new LineWebhookHttpServer({
    ingress: { handle: (request) => { requests.push(request); return { status: 200, acceptedEvents: [], replies: [] }; } },
    health: () => true,
  });
  const baseUrl = await listen(server);
  const rawBody = JSON.stringify({ events: [] });
  const signature = createHmac("sha256", "secret").update(rawBody).digest("base64");
  const response = await fetch(`${baseUrl}/webhooks/line`, { method: "POST", headers: { "x-line-signature": signature }, body: rawBody });
  assert.equal(response.status, 200);
  assert.deepEqual(requests, [{ rawBody, signature }]);
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", database: "ok" });
  await server.stop();
});

test("accepts the legacy LINE webhook path alias", async () => {
  const calls: string[] = [];
  const server = new LineWebhookHttpServer({ ingress: { handle: ({ rawBody }) => { calls.push(rawBody); return { status: 200, acceptedEvents: [], replies: [] }; } } });
  const address = await server.start(0, "127.0.0.1");
  const response = await fetch(`http://127.0.0.1:${address.port}/line/webhook`, { method: "POST", body: "{}" });
  await server.stop();
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["{}"]) ;
});

test("maps ingress status and rejects oversized webhook bodies", async () => {
  const responseStatuses: Array<200 | 400 | 401 | 503> = [401, 503];
  let index = 0;
  const server = new LineWebhookHttpServer({
    ingress: { handle: () => ({ status: responseStatuses[index++], acceptedEvents: [], replies: [] } as LineWebhookResponse) },
    bodyLimitBytes: 8,
  });
  const baseUrl = await listen(server);
  assert.equal((await fetch(`${baseUrl}/webhooks/line`, { method: "POST", body: "123456789" })).status, 413);
  const chunkedStatus = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${baseUrl}/webhooks/line`, { method: "POST", headers: { "transfer-encoding": "chunked" } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.write("1234");
    request.end("56789");
  });
  assert.equal(chunkedStatus, 413);
  assert.equal((await fetch(`${baseUrl}/webhooks/line`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(`${baseUrl}/webhooks/line`, { method: "POST", body: "{}" })).status, 503);
  assert.equal((await fetch(`${baseUrl}/unknown`)).status, 404);
  await server.stop();
});

test("returns health failure without exposing internal errors", async () => {
  const server = new LineWebhookHttpServer({ ingress: { handle: () => ({ status: 200, acceptedEvents: [], replies: [] }) }, health: () => false });
  const baseUrl = await listen(server);
  const response = await fetch(`${baseUrl}/healthz`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable", database: "unavailable" });
  await server.stop();
});
