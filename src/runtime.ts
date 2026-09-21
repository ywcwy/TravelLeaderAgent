import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { TravelDatabase } from "./database.ts";
import { LineWebhookHandler } from "./line-webhook-handler.ts";
import { LineWebhookIngress } from "./line-webhook-ingress.ts";
import { LineWebhookHttpServer, type ListeningAddress } from "./line-webhook-server.ts";
import { LineReplyApiClient } from "./line-reply-api.ts";
import { LineSourceWorker } from "./line-source-worker.ts";
import { loadRuntimeConfig, type RuntimeConfig } from "./runtime-config.ts";
import { TravelService } from "./travel-service.ts";
import { WebhookInbox } from "./webhook-inbox.ts";
import { FakeLlmAdapter, OpenAiCompatibleLlmAdapter, TimeoutFallbackLlmAdapter, type LlmAdapter } from "./extraction-draft.ts";
import { DeterministicQueryFilterAdapter } from "./query-filter.ts";
import { FakeQueryRouterAdapter, OpenAiCompatibleQueryRouter, type QueryRouterAdapter } from "./query-router.ts";

export interface RuntimePoller { start(): void | Promise<void>; stop(): void | Promise<void>; }

export class TravelLeaderRuntime {
  readonly config: RuntimeConfig;
  readonly database: TravelDatabase;
  readonly inbox: WebhookInbox;
  readonly service: TravelService;
  readonly worker: LineSourceWorker;
  readonly server: LineWebhookHttpServer;
  private readonly poller: RuntimePoller;
  private stopped = false;

  constructor(config: RuntimeConfig, poller?: RuntimePoller, environment: Record<string, string | undefined> = process.env) {
    this.config = config;
    if (config.databasePath !== ":memory:") mkdirSync(dirname(config.databasePath), { recursive: true });
    this.database = new TravelDatabase(config.databasePath);
    this.service = new TravelService(this.database, config.systemAdministratorId);
    const handler = new LineWebhookHandler(this.service, { channelSecret: config.channelSecret, officialAccountUserId: config.officialAccountUserId });
    this.inbox = new WebhookInbox(this.database);
    const ingress = new LineWebhookIngress(handler, this.inbox);
    const replyClient = new LineReplyApiClient(config.channelAccessToken);
    const extractionAdapter = createExtractionAdapter(config, environment);
    this.worker = new LineSourceWorker(this.inbox, this.service, (replyToken, text) => replyClient.reply(replyToken, text), extractionAdapter, new DeterministicQueryFilterAdapter(), createQueryRouter(config));
    this.poller = poller ?? { start: () => this.worker.start(config.workerPollMs), stop: () => this.worker.stop() };
    this.server = new LineWebhookHttpServer({ ingress, bodyLimitBytes: config.bodyLimitBytes, requestTimeoutMs: config.requestTimeoutMs, health: () => this.database.connection.prepare("SELECT 1").get() !== undefined });
  }

  async start(): Promise<ListeningAddress> { const address = await this.server.start(this.config.port, "0.0.0.0"); await this.poller.start(); return address; }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.server.stop();
    await this.poller?.stop();
    this.database.close();
  }
}

export function createQueryRouter(config: RuntimeConfig): QueryRouterAdapter | null {
  if (config.queryRouterAdapter === "disabled") return null;
  if (config.queryRouterAdapter === "fake") return new FakeQueryRouterAdapter();
  return new OpenAiCompatibleQueryRouter({
    apiKey: config.queryRouterAdapter === "grok" ? config.xAiApiKey! : config.openAiApiKey!, model: config.queryRouterModel, timeoutMs: config.queryRouterTimeoutMs,
    endpoint: config.queryRouterAdapter === "grok" ? "https://api.x.ai/v1/responses" : "https://api.openai.com/v1/responses",
  });
}

export function createExtractionAdapter(config: RuntimeConfig, environment: Record<string, string | undefined> = process.env): LlmAdapter {
  const primaryAdapter: LlmAdapter = config.extractionAdapter === "fake"
    ? new FakeLlmAdapter()
    : config.extractionAdapter === "grok"
      ? new OpenAiCompatibleLlmAdapter({ apiKey: config.xAiApiKey!, model: config.xAiModel, timeoutMs: config.xAiTimeoutMs, endpoint: "https://api.x.ai/v1/responses" })
      : new OpenAiCompatibleLlmAdapter({ apiKey: config.openAiApiKey!, model: config.openAiModel, timeoutMs: config.openAiTimeoutMs, endpoint: "https://api.openai.com/v1/responses" });
  const fallbackAdapter = configuredTimeoutFallback(config, environment);
  return fallbackAdapter ? new TimeoutFallbackLlmAdapter(primaryAdapter, fallbackAdapter) : primaryAdapter;
}

function configuredTimeoutFallback(config: RuntimeConfig, environment: Record<string, string | undefined>): LlmAdapter | null {
  const selected = environment.TRAVEL_EXTRACTION_FALLBACK_ADAPTER?.trim().toLowerCase();
  if (!selected || selected === "fake" || selected === config.extractionAdapter) return null;
  if (selected === "openai" && config.openAiApiKey) return new OpenAiCompatibleLlmAdapter({ apiKey: config.openAiApiKey, model: config.openAiModel, timeoutMs: config.openAiTimeoutMs, endpoint: "https://api.openai.com/v1/responses" });
  if (selected === "grok" && config.xAiApiKey) return new OpenAiCompatibleLlmAdapter({ apiKey: config.xAiApiKey, model: config.xAiModel, timeoutMs: config.xAiTimeoutMs, endpoint: "https://api.x.ai/v1/responses" });
  return null;
}

export function createRuntime(environment: Record<string, string | undefined> = process.env): TravelLeaderRuntime {
  const config = loadRuntimeConfig(environment);
  if (config.databasePath === ":memory:") throw new Error("TRAVEL_DATABASE_PATH must use persistent storage for the deployable runtime.");
  return new TravelLeaderRuntime(config, undefined, environment);
}
