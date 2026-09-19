import { TravelDatabase } from "./database.ts";
import { NotFoundError, TravelService } from "./travel-service.ts";

const [tripId, draftId, userId] = process.argv.slice(2);
const databasePath = process.env.TRAVEL_DATABASE_PATH?.trim() || "./data/travel.sqlite";

if (!tripId?.trim() || !draftId?.trim() || !userId?.trim()) {
  process.stderr.write("Usage: npm run confirm:trip-draft -- <trip-id> <draft-id> <originating-user-id>\n");
  process.exitCode = 1;
} else {
  const database = new TravelDatabase(databasePath);
  try {
    const travel = new TravelService(database, process.env.TRAVEL_SYSTEM_ADMINISTRATOR_ID?.trim() || "system-admin");
    const trip = travel.getTrip(tripId.trim());
    if (!trip) throw new NotFoundError(`Trip ${tripId} was not found.`);
    const result = travel.confirmExtractionDraft(trip.id, userId.trim(), draftId.trim().toUpperCase());
    const remainingReviewIssueCount = result.draft.issues.length + result.draft.missing.length;
    process.stdout.write(`${JSON.stringify({ draftId: result.draft.id, status: result.draft.status, proposalIds: result.proposalIds, remainingReviewIssueCount })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    database.close();
  }
}
