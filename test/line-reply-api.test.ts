import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { LineReplyApiClient, LineReplyApiError } from "../src/line-reply-api.ts";

test("sends a short reply through LINE's official Reply API", async () => {
  const requests: FakeRequest[] = [];
  const seenUrls: string[] = [];
  const fake = await startFakeServer(200, requests);
  const client = new LineReplyApiClient("channel-access-token", {
    fetchImpl: async (url, init) => { seenUrls.push(String(url)); return fetch(fake.url, init); },
  });

  await client.reply("reply-token", "已收到。");

  assert.deepEqual(seenUrls, ["https://api.line.me/v2/bot/message/reply"]);
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.headers.authorization, "Bearer channel-access-token");
  assert.equal(request.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(request.body), { replyToken: "reply-token", messages: [{ type: "text", text: "已收到。" }] });
  await fake.stop();
});

test("surfaces LINE errors without retrying", async () => {
  let calls = 0;
  const fake = await startFakeServer(400, []);
  const client = new LineReplyApiClient("token", { fetchImpl: async (_url, init) => { calls += 1; return fetch(fake.url, init); } });
  await assert.rejects(client.reply("reply-token", "ack"), (error: unknown) => error instanceof LineReplyApiError && error.status === 400);
  assert.equal(calls, 1);
  await fake.stop();
});

test("surfaces network and server failures without retrying", async () => {
  let calls = 0;
  const fake = await startFakeServer(500, []);
  const client = new LineReplyApiClient("token", { fetchImpl: async (_url, init) => { calls += 1; return fetch(fake.url, init); } });
  await assert.rejects(client.reply("reply-token", "ack"), (error: unknown) => error instanceof LineReplyApiError && error.status === 500);
  await fake.stop();
  const networkClient = new LineReplyApiClient("token", { fetchImpl: async () => { calls += 1; throw new Error("offline"); } });
  await assert.rejects(networkClient.reply("reply-token", "ack"), (error: unknown) => error instanceof LineReplyApiError && error.code === "network");
  assert.equal(calls, 2);
});

test("aborts a reply request that exceeds the timeout", async () => {
  const client = new LineReplyApiClient("token", { timeoutMs: 5, fetchImpl: (_url, init) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))); }) });
  await assert.rejects(client.reply("reply-token", "ack"), (error: unknown) => error instanceof LineReplyApiError && error.code === "timeout");
});

interface FakeRequest { headers: Record<string, string | string[] | undefined>; body: string; }

function startFakeServer(status: number, requests: FakeRequest[]): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => { response.writeHead(status); response.end(); requests.push({ headers: request.headers, body: Buffer.concat(chunks).toString("utf8") }); });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("fake server did not start"));
      resolve({ url: `http://127.0.0.1:${address.port}/reply`, stop: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}
