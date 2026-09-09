export const tripItemStatuses = [
  "confirmed",
  "provisional",
  "open_decision",
  "conflicted",
  "cancelled",
] as const;

export type TripItemStatus = (typeof tripItemStatuses)[number];
export type TripItemKind = "flight" | "lodging" | "rental_car" | "activity" | "transport" | "meeting" | "other";
export type ProposalStatus = "pending" | "confirmed" | "rejected";
export type MemberRole = "owner" | "member";
export type TripStatus = "active" | "archived";
export type DecisionStatus = "open" | "resolved";

export interface ExtractedTripItem {
  kind: TripItemKind;
  title: string;
  status: TripItemStatus;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  location?: string;
  notes?: string;
  deadlineAt?: string;
  sourceLine?: number;
  sourceExcerpt?: string;
}

export interface SourceImportOptions {
  idempotencyKey: string;
  sourceTime?: string;
}

export interface TripItem extends ExtractedTripItem {
  id: string;
  sourceId: string;
  confirmedBy: string | null;
}

export interface Proposal extends Omit<ExtractedTripItem, "status" | "deadlineAt"> {
  id: string;
  sourceId: string;
  itemStatus: TripItemStatus;
  status: ProposalStatus;
  deadlineAt: string | null;
}

export interface ReviewIssue {
  code: "missing_start_time" | "missing_timezone" | "missing_location" | "schedule_collision" | "source_unparsed";
  message: string;
  sourceId?: string;
  proposalIds: string[];
}

export interface TravelGroup {
  id: string;
  lineGroupId: string;
  displayName: string;
}

export interface Trip {
  id: string;
  travelGroupId: string;
  title: string;
  timezone: string;
  status: TripStatus;
}

export interface Decision {
  id: string;
  tripId: string;
  title: string;
  status: DecisionStatus;
  selectedProposalId: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface TripReview {
  confirmed: TripItem[];
  provisional: Proposal[];
  openDecisions: Proposal[];
  conflicts: Proposal[];
  issues: ReviewIssue[];
}
