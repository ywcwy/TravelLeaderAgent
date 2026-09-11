import assert from "node:assert/strict";
import test from "node:test";
import { LineReplyApiClient, LineReplyApiError } from "../src/line-reply-api.ts";

test("sends a short reply through LINE's official Reply API", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const client = new LineReplyApiClient("channel-access-token", {
    fetchImpl: async (url, init) => { requests.push({ url: String(url), init }); return new Response(null, { status: 200 }); },
  });

  await client.reply("reply-token", "已收到。");

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.url, "https://api.line.me/v2/bot/message/reply");
  assert.deepEqual(request.init?.headers, { Authorization: "Bearer channel-access-token", "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(String(request.init?.body)), { replyToken: "reply-token", messages: [{ type: "text", text: "已收到。" }] });
});

test("surfaces LINE errors without retrying", async () => {
  let calls = 0;
  const client = new LineReplyApiClient("token", { fetchImpl: async () => { calls += 1; return new Response("invalid token", { status: 400 }); } });
  await assert.rejects(client.reply("reply-token", "ack"), (error: unknown) => error instanceof LineReplyApiError && error.status === 400);
  assert.equal(calls, 1);
});

test("aborts a reply request that exceeds the timeout", async () => {
  const client = new LineReplyApiClient("token", { timeoutMs: 5, fetchImpl: (_url, init) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))); }) });
  await assert.rejects(client.reply("reply-token", "ack"), (error: unknown) => error instanceof LineReplyApiError && error.code === "timeout");
});
