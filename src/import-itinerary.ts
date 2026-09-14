import { readFileSync, statSync } from "node:fs";
import { TravelDatabase } from "./database.ts";
import { InvalidSourceError, TravelService } from "./travel-service.ts";

const [tripId, importBatchId, markdownPath] = process.argv.slice(2);
const administratorId = process.env.TRAVEL_SYSTEM_ADMINISTRATOR_ID?.trim() || "system-admin";
const databasePath = process.env.TRAVEL_DATABASE_PATH?.trim() || "./data/travel.sqlite";
const maxImportBytes = 1_048_576;

if (!tripId?.trim() || !importBatchId?.trim() || !markdownPath?.trim()) {
  process.stderr.write("Usage: npm run import:trip -- <trip-id> <import-batch-id> <markdown-file>\n");
  process.exitCode = 1;
} else {
  const database = new TravelDatabase(databasePath);
  try {
    const size = statSync(markdownPath).size;
    if (size > maxImportBytes) throw new InvalidSourceError(`Markdown file exceeds the ${maxImportBytes}-byte import limit.`);
    const markdown = readFileSync(markdownPath, "utf8");
    const travel = new TravelService(database, administratorId);
    const result = travel.importMarkdownBatch(tripId.trim(), markdown, importBatchId.trim());
    const review = travel.reviewTrip(tripId.trim());
    process.stdout.write(`${JSON.stringify({ ...result, reviewIssueCount: review.issues.length })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    database.close();
  }
}
