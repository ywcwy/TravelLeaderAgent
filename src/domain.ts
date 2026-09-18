export const tripItemStatuses = [
  "confirmed",
  "provisional",
  "open_decision",
  "conflicted",
  "cancelled",
] as const;

export type TripItemStatus = (typeof tripItemStatuses)[number];
export const tripItemKinds = ["flight", "lodging", "rental_car", "transport", "meal", "activity", "shopping", "meeting", "other"] as const;
export type TripItemKind = (typeof tripItemKinds)[number];
export const proposalShapes = ["point", "route"] as const;
export type ProposalShape = (typeof proposalShapes)[number];
export const proposalShapeSources = ["explicit", "inferred"] as const;
export type ProposalShapeSource = (typeof proposalShapeSources)[number];
export const timezoneSources = ["explicit", "inferred", "fallback"] as const;
export type TimezoneSource = (typeof timezoneSources)[number];
export type ProposalStatus = "pending" | "confirmed" | "rejected";
export type MemberRole = "owner" | "member";
export type TripStatus = "active" | "archived";
export type DecisionStatus = "open" | "resolved" | "needs_options" | "cancelled";
export const extractionDraftStatuses = ["pending_confirmation", "confirmed", "cancelled", "failed"] as const;
export type ExtractionDraftStatus = (typeof extractionDraftStatuses)[number];
export const timeFlexibilities = ["required", "estimated", "flexible"] as const;
export type TimeFlexibility = (typeof timeFlexibilities)[number];
export const timeWindows = ["morning", "afternoon", "evening", "night"] as const;
export type TimeWindow = (typeof timeWindows)[number];

export interface ExtractedTripItem {
  kind: TripItemKind;
  kinds: TripItemKind[];
  shape: ProposalShape;
  shapeSource: ProposalShapeSource;
  title: string;
  status: TripItemStatus;
  localDate?: string;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  timezoneSource?: TimezoneSource;
  originTimezone?: string;
  destinationTimezone?: string;
  location?: string;
  origin?: string;
  destination?: string;
  notes?: string;
  deadlineAt?: string;
  sourceLine?: number;
  sourceExcerpt?: string;
  startTimeFlexibility?: TimeFlexibility;
  endTimeFlexibility?: TimeFlexibility;
  timeWindow?: TimeWindow;
  assumptions?: string[];
}

export interface ExtractionDraftItem extends ExtractedTripItem {
  startTimeFlexibility: TimeFlexibility;
  endTimeFlexibility: TimeFlexibility;
  timeWindow?: TimeWindow;
}

export interface ExtractionDraftMissing {
  field: string;
  message: string;
  required: boolean;
}

export interface ExtractionDraftIssue {
  code: string;
  message: string;
}

export interface ExtractionDraftPayload {
  items: ExtractionDraftItem[];
  missing: ExtractionDraftMissing[];
  assumptions: string[];
  issues: ExtractionDraftIssue[];
  sourceExcerpt: string;
}

export interface ExtractionDraftMetadata {
  provider: string;
  model: string;
  promptVersion: string;
}

export interface ExtractionDraft extends ExtractionDraftPayload {
  id: string;
  tripId: string;
  sourceId: string;
  originatingUserId: string | null;
  revision: number;
  previousDraftId: string | null;
  status: ExtractionDraftStatus;
  metadata: ExtractionDraftMetadata;
  proposalIds: string[];
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceImportOptions {
  idempotencyKey: string;
  sourceTime?: string;
  type?: string;
  provenance?: SourceProvenance;
}

export interface SourceProvenance {
  provider: string;
  messageId: string;
  groupId?: string;
  userId?: string;
}

export interface Source {
  id: string;
  tripId: string;
  type: string;
  idempotencyKey: string;
  content: string;
  sourceTime: string;
  provenance: SourceProvenance | null;
}

export interface TripItem extends ExtractedTripItem {
  id: string;
  sourceId: string;
  replacementForItemId: string | null;
  confirmedBy: string | null;
}

export interface Proposal extends Omit<ExtractedTripItem, "status" | "deadlineAt"> {
  id: string;
  sourceId: string;
  replacementForItemId: string | null;
  itemStatus: TripItemStatus;
  status: ProposalStatus;
  deadlineAt: string | null;
  rejectionReason: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
}

export interface ProposalContext {
  proposal: Proposal;
  confirmed: TripItem[];
  overlappingConfirmed: TripItem[];
  pending: Proposal[];
}

export interface ReviewIssue {
  code: "missing_start_time" | "missing_timezone" | "invalid_timezone" | "missing_endpoint_timezone" | "invalid_endpoint_timezone" | "ambiguous_local_time" | "missing_location" | "missing_route_endpoint" | "shape_conflict" | "unknown_kind" | "kind_clarification" | "schedule_collision" | "source_unparsed" | "unparseable_line" | "low_information_item" | "duplicate_item" | "contradictory_item";
  message: string;
  sourceId?: string;
  sourceLine?: number;
  sourceExcerpt?: string;
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

export interface TripAccessPolicy {
  tripId: string;
  memberCanViewPending: boolean;
  memberCanViewReviewIssues: boolean;
  memberCanViewCancelledHistory: boolean;
  memberCanViewSourceContent: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface TripAccessPolicyUpdate {
  memberCanViewPending?: boolean;
  memberCanViewReviewIssues?: boolean;
  memberCanViewCancelledHistory?: boolean;
  memberCanViewSourceContent?: boolean;
}

export interface ItineraryQuery {
  tripId?: string;
  includeArchived?: boolean;
  includeSourceContent?: boolean;
  continuationToken?: string;
  pageSize?: number;
  date?: string;
  location?: string;
  kind?: TripItemKind;
  pendingOnly?: boolean;
  reviewIssuesOnly?: boolean;
  proposalId?: string;
}

export interface ItineraryQueryResult {
  trip: Trip;
  confirmed: TripItem[];
  pending: Proposal[];
  openDecisions: Decision[];
  issues: ReviewIssue[];
  sources: Source[];
  nextPageToken: string | null;
}

export interface Decision {
  id: string;
  tripId: string;
  title: string;
  status: DecisionStatus;
  selectedProposalId: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
}

export interface TripReview {
  confirmed: TripItem[];
  cancelled: TripItem[];
  pending: Proposal[];
  rejected: Proposal[];
  provisional: Proposal[];
  openDecisions: Proposal[];
  conflicts: Proposal[];
  issues: ReviewIssue[];
  decisions: Decision[];
}
