import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { LineWebhookRequest, LineWebhookResponse } from "./line-webhook-handler.ts";

export interface LineWebhookIngressLike { handle(request: LineWebhookRequest): LineWebhookResponse; }
export interface LineWebhookHttpServerOptions {
  ingress: LineWebhookIngressLike;
  health?: () => boolean | Promise<boolean>;
  bodyLimitBytes?: number;
  requestTimeoutMs?: number;
  logger?: (entry: { event: string; status?: number; errorType?: string; latencyMs?: number }) => void;
}
export interface ListeningAddress { host: string; port: number; }

export class LineWebhookHttpServer {
  private readonly server: Server;
  private readonly options: Required<Pick<LineWebhookHttpServerOptions, "bodyLimitBytes" | "requestTimeoutMs">> & LineWebhookHttpServerOptions;
  private listening = false;

  constructor(options: LineWebhookHttpServerOptions) {
    this.options = { bodyLimitBytes: 256 * 1024, requestTimeoutMs: 10_000, ...options };
    this.server = createServer((request, response) => { void this.handle(request, response); });
  }

  start(port = 3000, host = "127.0.0.1"): Promise<ListeningAddress> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => { this.server.off("listening", onListening); reject(error); };
      const onListening = () => {
        this.server.off("error", onError);
        const address = this.server.address();
        if (!address || typeof address === "string") return reject(new Error("HTTP server did not expose a socket address."));
        this.listening = true;
        resolve({ host, port: address.port });
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(port, host);
    });
  }

  stop(): Promise<void> {
    if (!this.listening) return Promise.resolve();
    return new Promise((resolve, reject) => this.server.close((error) => { if (error) reject(error); else { this.listening = false; resolve(); } }));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const started = Date.now();
    try {
      if (request.method === "GET" && request.url === "/healthz") {
        const healthy = await (this.options.health?.() ?? true);
        this.sendJson(response, healthy ? 200 : 503, healthy ? { status: "ok", database: "ok" } : { status: "unavailable", database: "unavailable" });
        return;
      }
      if (request.method !== "POST" || request.url !== "/webhooks/line") { this.sendJson(response, 404, { error: "not_found" }); return; }
      const rawBody = await this.readBody(request);
      const signature = this.header(request, "x-line-signature");
      const result = this.options.ingress.handle({ rawBody, signature });
      this.sendJson(response, result.status, { status: result.status });
      this.log({ event: "webhook", status: result.status, latencyMs: Date.now() - started });
    } catch (error) {
      const status = error instanceof BodyLimitError ? 413 : error instanceof RequestTimeoutError ? 408 : 503;
      this.sendJson(response, status, { error: status === 413 ? "payload_too_large" : status === 408 ? "request_timeout" : "service_unavailable" });
      this.log({ event: "webhook_error", status, errorType: error instanceof Error ? error.constructor.name : "UnknownError", latencyMs: Date.now() - started });
    }
  }

  private readBody(request: IncomingMessage): Promise<string> {
    const declaredLength = Number(request.headers["content-length"] ?? 0);
    if (declaredLength > this.options.bodyLimitBytes) return Promise.reject(new BodyLimitError());
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []; let length = 0; let settled = false;
      const finish = (callback: () => void) => { if (!settled) { settled = true; request.setTimeout(0); callback(); } };
      request.setTimeout(this.options.requestTimeoutMs, () => finish(() => reject(new RequestTimeoutError())));
      request.on("data", (chunk: Buffer | string) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += buffer.length;
        if (length > this.options.bodyLimitBytes) { request.resume(); finish(() => reject(new BodyLimitError())); return; }
        chunks.push(buffer);
      });
      request.on("end", () => finish(() => resolve(Buffer.concat(chunks).toString("utf8"))));
      request.on("error", (error) => finish(() => reject(error)));
    });
  }

  private header(request: IncomingMessage, name: string): string { const value = request.headers[name]; return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
  private sendJson(response: ServerResponse, status: number, body: object): void { if (response.headersSent) return; response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); }
  private log(entry: { event: string; status?: number; errorType?: string; latencyMs?: number }): void { this.options.logger?.(entry); }
}

class BodyLimitError extends Error {}
class RequestTimeoutError extends Error {}
