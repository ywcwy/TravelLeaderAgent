import { readFileSync, statSync } from "node:fs";
import { TravelDatabase } from "./database.ts";
import { OpenAiCompatibleLlmAdapter, TimeoutFallbackLlmAdapter, type LlmAdapter } from "./extraction-draft.ts";
import { isHumanConfirmedTable } from "./human-confirmed-table.ts";
import { InvalidSourceError, TravelService } from "./travel-service.ts";

const [tripId, importBatchId, markdownPath] = process.argv.slice(2);
const administratorId = process.env.TRAVEL_SYSTEM_ADMINISTRATOR_ID?.trim() || "system-admin";
const databasePath = process.env.TRAVEL_DATABASE_PATH?.trim() || "./data/travel.sqlite";
const maxImportBytes = 1_048_576;

if (!tripId?.trim() || !importBatchId?.trim() || !markdownPath?.trim()) {
  process.stderr.write("Usage: npm run import:trip -- <trip-id> <import-batch-id> <markdown-file>\n");
  process.exitCode = 1;
} else {
  void run();
}

async function run(): Promise<void> {
  const database = new TravelDatabase(databasePath);
  try {
    const size = statSync(markdownPath).size;
    if (size > maxImportBytes) throw new InvalidSourceError(`Markdown file exceeds the ${maxImportBytes}-byte import limit.`);
    const markdown = readFileSync(markdownPath, "utf8");
    const travel = new TravelService(database, administratorId);
    const result = isHumanConfirmedTable(markdown)
      ? travel.importHumanConfirmedTableDraft(tripId.trim(), markdown, importBatchId.trim(), administratorId)
      : isStructuredMarkdown(markdown)
        ? travel.importMarkdownDraftBatch(tripId.trim(), markdown, importBatchId.trim(), administratorId)
      : await importNaturalMarkdown(travel, database, tripId.trim(), markdown, importBatchId.trim());
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    database.close();
  }
}

async function importNaturalMarkdown(travel: TravelService, database: TravelDatabase, tripIdValue: string, markdown: string, batchId: string) {
  const adapter = configuredLlmAdapter();
  const existing = database.connection.prepare(`SELECT id, content FROM sources WHERE trip_id = ? AND idempotency_key = ?`).get(tripIdValue, batchId) as { id: string; content: string } | undefined;
  if (existing && existing.content !== markdown) throw new InvalidSourceError(`Import Batch ${batchId} already contains different content.`);
  const draft = await travel.createExtractionDraft(tripIdValue, markdown, {
    idempotencyKey: batchId,
    type: "markdown",
    provenance: { provider: "markdown-import", messageId: batchId, userId: administratorId },
  }, adapter);
  return {
    sourceId: draft.sourceId,
    draftId: draft.id,
    proposalIds: draft.proposalIds,
    itemCount: draft.items.length,
    reviewIssueCount: draft.issues.length + draft.missing.length,
    dateRange: dateRange(draft.items),
    chunkCount: travel.getImportChunks(tripIdValue, draft.sourceId).length,
    outcome: existing ? "reused" : "created",
  } as const;
}

function configuredLlmAdapter(): LlmAdapter {
  const selected = process.env.TRAVEL_EXTRACTION_ADAPTER?.trim().toLowerCase() || "fake";
  if (selected === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new InvalidSourceError("Raw Markdown import requires OPENAI_API_KEY when TRAVEL_EXTRACTION_ADAPTER=openai.");
    const primary = new OpenAiCompatibleLlmAdapter({ apiKey, model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini", timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS) || 60_000 });
    return withConfiguredFallback(primary, "openai");
  }
  if (selected === "grok") {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) throw new InvalidSourceError("Raw Markdown import requires XAI_API_KEY when TRAVEL_EXTRACTION_ADAPTER=grok.");
    const primary = new OpenAiCompatibleLlmAdapter({ apiKey, model: process.env.XAI_MODEL?.trim() || "grok-4.6", timeoutMs: Number(process.env.XAI_TIMEOUT_MS) || 60_000, endpoint: "https://api.x.ai/v1/responses" });
    return withConfiguredFallback(primary, "grok");
  }
  if (selected === "fake") throw new InvalidSourceError("Raw Markdown import requires TRAVEL_EXTRACTION_ADAPTER=openai or grok; fake extraction only supports structured test fixtures.");
  throw new InvalidSourceError("TRAVEL_EXTRACTION_ADAPTER must be 'openai' or 'grok' for raw Markdown import.");
}

function withConfiguredFallback(primary: LlmAdapter, selected: "openai" | "grok"): LlmAdapter {
  const fallback = process.env.TRAVEL_EXTRACTION_FALLBACK_ADAPTER?.trim().toLowerCase();
  if (fallback === "openai" && selected !== "openai" && process.env.OPENAI_API_KEY?.trim()) return new TimeoutFallbackLlmAdapter(primary, new OpenAiCompatibleLlmAdapter({ apiKey: process.env.OPENAI_API_KEY.trim(), model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini", timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS) || 60_000 }));
  if (fallback === "grok" && selected !== "grok" && process.env.XAI_API_KEY?.trim()) return new TimeoutFallbackLlmAdapter(primary, new OpenAiCompatibleLlmAdapter({ apiKey: process.env.XAI_API_KEY.trim(), model: process.env.XAI_MODEL?.trim() || "grok-4.6", timeoutMs: Number(process.env.XAI_TIMEOUT_MS) || 60_000, endpoint: "https://api.x.ai/v1/responses" }));
  return primary;
}

function isStructuredMarkdown(markdown: string): boolean {
  return /^\s*(?:@[^-]*?\s+)?-\s*\[(?:confirmed|provisional|open_decision|conflicted)\]/imu.test(markdown);
}

function dateRange(items: Array<{ localDate?: string; startsAt?: string; endsAt?: string }>): { from: string | null; to: string | null } {
  const dates = items.flatMap((item) => [item.localDate, item.startsAt?.slice(0, 10), item.endsAt?.slice(0, 10)]).filter((value): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))).sort();
  return { from: dates[0] ?? null, to: dates.at(-1) ?? null };
}
