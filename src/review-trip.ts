import { TravelDatabase } from "./database.ts";
import type { Proposal, TripReview, TripItem } from "./domain.ts";
import { formatLocalDateTime } from "./timezone.ts";
import { NotFoundError, TravelService } from "./travel-service.ts";

const [tripId, ...flags] = process.argv.slice(2);
const databasePath = process.env.TRAVEL_DATABASE_PATH?.trim() || "./data/travel.sqlite";

if (!tripId?.trim()) {
  process.stderr.write("Usage: npm run review:trip -- <trip-id> [--json]\n");
  process.exitCode = 1;
} else {
  const database = new TravelDatabase(databasePath);
  try {
    const travel = new TravelService(database, process.env.TRAVEL_SYSTEM_ADMINISTRATOR_ID?.trim() || "system-admin");
    const trip = travel.getTrip(tripId.trim());
    if (!trip) throw new NotFoundError(`Trip ${tripId} was not found.`);
    const review = travel.reviewTrip(trip.id);
    const extractionDrafts = travel.getLatestExtractionDrafts(trip.id).map((entry) => ({ ...entry, chunks: travel.getImportChunks(trip.id, entry.draft.sourceId) }));
    const result = toResult(trip, review, extractionDrafts);
    process.stdout.write(flags.includes("--json") ? `${JSON.stringify(result)}\n` : `${renderHuman(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    database.close();
  }
}

function toResult(trip: NonNullable<ReturnType<TravelService["getTrip"]>>, review: TripReview, extractionDrafts: Array<ReturnType<TravelService["getLatestExtractionDrafts"]>[number] & { chunks: ReturnType<TravelService["getImportChunks"]> }>) {
  return {
    trip,
    effectiveItinerary: review.confirmed,
    pendingProposals: review.pending,
    rejectedProposals: review.rejected,
    decisions: review.decisions,
    reviewIssues: review.issues,
    extractionDrafts,
    counts: {
      confirmed: review.confirmed.length,
      pending: review.pending.length,
      rejected: review.rejected.length,
      decisions: review.decisions.length,
      reviewIssues: review.issues.length,
      extractionDrafts: extractionDrafts.length,
    },
  };
}

function renderHuman(result: ReturnType<typeof toResult>): string {
  const lines = [
    `Trip: ${result.trip.id} | ${result.trip.title} | ${result.trip.status} | ${result.trip.timezone}`,
    `Effective Itinerary (${result.counts.confirmed})`,
    ...result.effectiveItinerary.map(formatTripItem),
    `Pending Proposals (${result.counts.pending})`,
    ...result.pendingProposals.map(formatProposal),
    `Rejected Proposals (${result.counts.rejected})`,
    ...result.rejectedProposals.map((proposal) => `${formatProposal(proposal)}${proposal.rejectionReason ? ` | reason: ${proposal.rejectionReason}` : ""}${proposal.rejectedBy ? ` | by: ${proposal.rejectedBy}` : ""}`),
    `Decisions (${result.counts.decisions})`,
    ...result.decisions.map((decision) => `- ${decision.id} | ${decision.status} | ${decision.title}${decision.selectedProposalId ? ` | selected: ${decision.selectedProposalId}` : ""}${decision.cancelledBy ? ` | cancelled by: ${decision.cancelledBy}` : ""}`),
    `Extraction Drafts (${result.counts.extractionDrafts})`,
    ...result.extractionDrafts.map(({ draft, importBatchId, chunks }) => {
      const dates = draftDateRange(draft);
      const chunkSummary = chunks.length > 0 ? ` | Chunks ${chunks.length} (${chunks.map((chunk) => `${chunk.ordinal + 1}:${chunk.status}`).join(",")})` : "";
      return `- ${draft.id} | batch ${importBatchId} | ${draft.status} | revision ${draft.revision} | ${draft.items.length} items | ${dates.from ?? "undated"}${dates.to && dates.to !== dates.from ? `..${dates.to}` : ""} | Review Issues ${draft.issues.length + draft.missing.length}${chunkSummary}`;
    }),
    `Review Issues (${result.counts.reviewIssues})`,
    ...result.reviewIssues.map((issue) => `- [${issue.code}] ${issue.message}${issue.sourceLine ? ` (line ${issue.sourceLine})` : ""}`),
  ];
  return lines.join("\n");
}

function draftDateRange(draft: { items: Array<{ localDate?: string; startsAt?: string; endsAt?: string }> }): { from: string | null; to: string | null } {
  const dates = draft.items.flatMap((item) => [item.localDate, item.startsAt?.slice(0, 10), item.endsAt?.slice(0, 10)]).filter((value): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))).sort();
  return { from: dates[0] ?? null, to: dates.at(-1) ?? null };
}

function formatTripItem(item: TripItem): string {
  const place = item.shape === "route"
    ? `${item.origin ?? "?"} → ${item.destination ?? "?"}`
    : item.location;
  const time = item.startsAt ? ` | ${item.timezone ? formatLocalDateTime(item.startsAt, item.timezone) : item.startsAt}` : "";
  const endpointZones = item.originTimezone || item.destinationTimezone ? ` | ${item.originTimezone ?? item.timezone ?? "?"} → ${item.destinationTimezone ?? item.timezone ?? "?"}` : "";
  return `- [${item.shape}] [${item.kinds.join(", ")}] ${item.title}${time}${item.timezone ? ` | ${item.timezone}` : ""}${endpointZones}${item.timezoneSource === "fallback" ? " | timezone fallback" : ""}${place ? ` | ${place}` : ""}`;
}

function formatProposal(proposal: Proposal): string {
  const place = proposal.shape === "route"
    ? `${proposal.origin ?? "?"} → ${proposal.destination ?? "?"}`
    : proposal.location;
  const time = proposal.startsAt ? ` | ${proposal.timezone ? formatLocalDateTime(proposal.startsAt, proposal.timezone) : proposal.startsAt}` : "";
  const endpointZones = proposal.originTimezone || proposal.destinationTimezone ? ` | ${proposal.originTimezone ?? proposal.timezone ?? "?"} → ${proposal.destinationTimezone ?? proposal.timezone ?? "?"}` : "";
  return `- ${proposal.id} | [${proposal.shape}] [${proposal.kinds.join(", ")}] ${proposal.itemStatus} / ${proposal.status} | ${proposal.title}${time}${proposal.timezone ? ` | ${proposal.timezone}` : ""}${endpointZones}${proposal.timezoneSource === "fallback" ? " | timezone fallback" : ""}${place ? ` | ${place}` : ""}`;
}
