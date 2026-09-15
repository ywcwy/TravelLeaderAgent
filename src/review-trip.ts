import { TravelDatabase } from "./database.ts";
import type { Proposal, TripReview, TripItem } from "./domain.ts";
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
    const result = toResult(trip, review);
    process.stdout.write(flags.includes("--json") ? `${JSON.stringify(result)}\n` : `${renderHuman(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    database.close();
  }
}

function toResult(trip: NonNullable<ReturnType<TravelService["getTrip"]>>, review: TripReview) {
  return {
    trip,
    effectiveItinerary: review.confirmed,
    pendingProposals: review.pending,
    rejectedProposals: review.rejected,
    decisions: review.decisions,
    reviewIssues: review.issues,
    counts: {
      confirmed: review.confirmed.length,
      pending: review.pending.length,
      rejected: review.rejected.length,
      decisions: review.decisions.length,
      reviewIssues: review.issues.length,
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
    `Review Issues (${result.counts.reviewIssues})`,
    ...result.reviewIssues.map((issue) => `- [${issue.code}] ${issue.message}${issue.sourceLine ? ` (line ${issue.sourceLine})` : ""}`),
  ];
  return lines.join("\n");
}

function formatTripItem(item: TripItem): string {
  const place = item.shape === "route"
    ? `${item.origin ?? "?"} → ${item.destination ?? "?"}`
    : item.location;
  return `- [${item.shape}] [${item.kinds.join(", ")}] ${item.title}${item.startsAt ? ` | ${item.startsAt}` : ""}${place ? ` | ${place}` : ""}`;
}

function formatProposal(proposal: Proposal): string {
  const place = proposal.shape === "route"
    ? `${proposal.origin ?? "?"} → ${proposal.destination ?? "?"}`
    : proposal.location;
  return `- ${proposal.id} | [${proposal.shape}] [${proposal.kinds.join(", ")}] ${proposal.itemStatus} / ${proposal.status} | ${proposal.title}${proposal.startsAt ? ` | ${proposal.startsAt}` : ""}${place ? ` | ${place}` : ""}`;
}
