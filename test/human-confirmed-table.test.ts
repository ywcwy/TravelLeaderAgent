import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { TravelDatabase } from "../src/database.ts";
import { isHumanConfirmedTable, parseHumanConfirmedTable, validateHumanConfirmedTableItems } from "../src/human-confirmed-table.ts";
import { ConflictError, PermissionError, TravelService } from "../src/travel-service.ts";

const table = `<!-- itinerary-table -->
format_version: 1
confirmation_status: draft

## Itinerary Table
| item_key | title | status | kind | shape | date | start_time | end_time | timezone | location | city | region | country | origin | origin_city | origin_region | origin_country | origin_timezone | destination | destination_city | destination_region | destination_country | destination_timezone | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1-01 | Page 午餐 | confirmed | meal | point | 2026-10-02 | 13:45 | 14:30 | America/Phoenix | Page | Page | Arizona | United States |  |  |  |  |  |  |  |  |  |  | BirdHouse \\| Big John's |
| D1-02 | Page 到 Tusayan | provisional | transport | route | 2026-10-02 | 15:00 | 16:30 |  |  |  |  |  | Page | Page | Arizona | United States | America/Phoenix | Tusayan | Tusayan | Arizona | United States | America/Phoenix | 車程約 1.5 小時 |
| D1-03 | Page 晚餐 | open_decision | meal | point | 2026-10-02 | 19:00 | 20:00 | America/Phoenix | Page | Page | Arizona | United States |  |  |  |  |  |  |  |  |  |  | BirdHouse 或 El Tapatio |

## Notes
這段說明保留在 Draft，但不會建立第三個 item。
`;

test("parses a versioned Human-confirmed Table with point, route, and escaped pipes", () => {
  assert.equal(isHumanConfirmedTable(table), true);
  const parsed = parseHumanConfirmedTable(table);
  assert.equal(parsed.formatVersion, "1");
  assert.equal(parsed.confirmationStatus, "draft");
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.items[0]?.itemKey, "D1-01");
  assert.equal(parsed.items[0]?.title, "Page 午餐");
  assert.equal(parsed.items[0]?.startsAt, "2026-10-02T13:45:00");
  assert.equal(parsed.items[0]?.notes, "BirdHouse | Big John's");
  assert.equal(parsed.items[1]?.shape, "route");
  assert.equal(parsed.items[1]?.origin, "Page");
  assert.equal(parsed.items[1]?.destination, "Tusayan");
  assert.deepEqual(parsed.notes, ["這段說明保留在 Draft，但不會建立第三個 item。"]);
  assert.deepEqual(parsed.issues, []);
});

test("imports the Human-confirmed Table as a reviewable Draft through the service boundary", () => {
  const database = new TravelDatabase();
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-human-table", "Human Table");
  const trip = travel.createActiveTrip("system-admin", group.id, "Table 旅程", "Asia/Taipei");
  const result = travel.importHumanConfirmedTableDraft(trip.id, table, "table-v1");
  assert.equal(result.itemCount, 3);
  assert.equal(result.proposalIds.length, 0);
  assert.equal(result.outcome, "created");
  const draft = travel.getExtractionDraft(trip.id, result.draftId);
  assert.equal(draft?.metadata.provider, "deterministic-table");
  assert.equal(draft?.metadata.promptVersion, "human-table-v1");
  assert.equal(draft?.documentFormatVersion, "1");
  assert.equal(draft?.documentConfirmationStatus, "draft");
  assert.equal(draft?.items[1]?.itemKey, "D1-02");
  assert.match(draft?.assumptions.join("\n") ?? "", /Table Note/);
  const replay = travel.importHumanConfirmedTableDraft(trip.id, table, "table-v1");
  assert.equal(replay.outcome, "reused");
  assert.equal(replay.draftId, result.draftId);
  database.close();
});

test("allows a Trip member to submit a Draft but rejects an outsider", () => {
  const database = new TravelDatabase();
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-human-table-members", "Human Table Members");
  const trip = travel.createActiveTrip("system-admin", group.id, "Table Members", "Asia/Taipei");
  travel.addMember("system-admin", trip.id, "U-member", "Member", "member");
  assert.throws(() => travel.importHumanConfirmedTableDraft(trip.id, table, "outsider-table", "U-outsider"), PermissionError);
  const result = travel.importHumanConfirmedTableDraft(trip.id, table, "member-table", "U-member");
  assert.equal(result.itemCount, 3);
  database.close();
});

test("retains malformed row width and unsupported status as Draft review issues", () => {
  const malformed = table.replace("| D1-01 | Page 午餐 | confirmed |", "| D1-01 | Page 午餐 | cancelled |")
    .replace("| D1-02 | Page 到 Tusayan | provisional | transport | route |", "| D1-02 | Page 到 Tusayan | provisional | transport | route | extra-cell | 2026-10-02 |");
  const parsed = parseHumanConfirmedTable(malformed);
  assert.ok(parsed.issues.some((issue) => /status 不支援/.test(issue.message)));
  assert.ok(parsed.issues.some((issue) => /欄位數量錯誤/.test(issue.message)));
  assert.equal(parsed.items.length, 3);
});

test("confirms a mixed-status Human-confirmed Table into Trip Items, Proposals, and Decisions", () => {
  const database = new TravelDatabase();
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-human-table-confirm", "Human Table Confirm");
  const trip = travel.createActiveTrip("system-admin", group.id, "Table Confirm", "Asia/Taipei");
  travel.addMember("system-admin", trip.id, "U-owner", "Owner", "owner");
  travel.addMember("system-admin", trip.id, "U-member", "Member", "member");
  const imported = travel.importHumanConfirmedTableDraft(trip.id, table, "table-confirm", "U-member");
  assert.throws(() => travel.confirmHumanConfirmedTable(trip.id, "U-member", imported.draftId), PermissionError);
  const confirmed = travel.confirmHumanConfirmedTable(trip.id, "U-owner", imported.draftId);
  assert.equal(confirmed.tripItemIds.length, 1);
  assert.equal(confirmed.proposalIds.length, 2);
  assert.equal(confirmed.decisionIds.length, 1);
  assert.equal(confirmed.draft.status, "confirmed");
  const review = travel.reviewTrip(trip.id);
  assert.equal(review.confirmed.some((item) => item.title === "Page 午餐"), true);
  assert.equal(review.pending.some((proposal) => proposal.title === "Page 到 Tusayan" && proposal.itemStatus === "provisional"), true);
  assert.equal(review.pending.some((proposal) => proposal.title === "Page 晚餐" && proposal.itemStatus === "open_decision"), true);
  assert.equal(review.openDecisions.length, 1);
  const replay = travel.confirmHumanConfirmedTable(trip.id, "U-owner", imported.draftId);
  assert.deepEqual(replay.proposalIds, confirmed.proposalIds);
  assert.equal(travel.reviewTrip(trip.id).confirmed.filter((item) => item.title === "Page 午餐").length, 1);
  database.close();
});

test("blocks confirmation when a confirmed row still has table validation errors", () => {
  const database = new TravelDatabase();
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-human-table-invalid-confirm", "Invalid Table Confirm");
  const trip = travel.createActiveTrip("system-admin", group.id, "Invalid Table Confirm", "Asia/Taipei");
  travel.addMember("system-admin", trip.id, "U-owner", "Owner", "owner");
  const invalid = table.replace("| Page | Page | Arizona | United States |", "| Page | Las Vegas | Nevada | United States |");
  const imported = travel.importHumanConfirmedTableDraft(trip.id, invalid, "table-invalid-confirm", "U-owner");
  assert.throws(() => travel.confirmHumanConfirmedTable(trip.id, "U-owner", imported.draftId), ConflictError);
  assert.equal(travel.getExtractionDraft(trip.id, imported.draftId)?.status, "pending_confirmation");
  assert.equal(travel.reviewTrip(trip.id).confirmed.length, 0);
  database.close();
});

test("reuses identical table checksums and creates linked revisions for changed content", () => {
  const database = new TravelDatabase();
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-human-table-revisions", "Human Table Revisions");
  const trip = travel.createActiveTrip("system-admin", group.id, "Table Revisions", "Asia/Taipei");
  travel.addMember("system-admin", trip.id, "U-owner", "Owner", "owner");
  const first = travel.importHumanConfirmedTableDraft(trip.id, table, "table-revision", "U-owner");
  const changedTable = table.replace("Page 午餐", "Page 早餐");
  const revised = travel.importHumanConfirmedTableDraft(trip.id, changedTable, "table-revision", "U-owner");
  assert.equal(revised.outcome, "revised");
  assert.notEqual(revised.sourceId, first.sourceId);
  const revisedDraft = travel.getExtractionDraft(trip.id, revised.draftId)!;
  assert.equal(revisedDraft.revision, 2);
  assert.equal(revisedDraft.previousDraftId, first.draftId);
  const replay = travel.importHumanConfirmedTableDraft(trip.id, changedTable, "different-batch", "U-owner");
  assert.equal(replay.outcome, "reused");
  assert.equal(replay.sourceId, revised.sourceId);
  assert.throws(() => travel.confirmHumanConfirmedTable(trip.id, "U-owner", first.draftId), ConflictError);
  database.close();
});

test("validates confirmed geography and time fields without removing valid rows", () => {
  const parsed = parseHumanConfirmedTable(table);
  const point = { ...parsed.items[0]!, city: "Las Vegas", region: "Nevada" };
  const route = { ...parsed.items[1]!, status: "confirmed" as const, originCity: undefined, originRegion: undefined, originCountry: undefined, originTimezone: undefined };
  const issues = validateHumanConfirmedTableItems([point, route]);
  assert.equal(parsed.items.length, 3);
  assert.ok(issues.some((issue) => /與 Registry 不一致/.test(issue.message)));
  assert.ok(issues.some((issue) => /origin_city/.test(issue.message)));
  assert.ok(issues.some((issue) => /origin_timezone/.test(issue.message)));
});

test("CLI detects Human-confirmed Table input without invoking an LLM", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-leader-agent-human-table-cli-"));
  const databasePath = join(directory, "travel.sqlite");
  const markdownPath = join(directory, "table.md");
  writeFileSync(markdownPath, table);
  const database = new TravelDatabase(databasePath);
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-human-table-cli", "Human Table CLI");
  const trip = travel.createActiveTrip("system-admin", group.id, "Table CLI", "Asia/Taipei");
  database.close();
  const output = execFileSync(process.execPath, ["--experimental-strip-types", "src/import-itinerary.ts", trip.id, "table-cli-v1", markdownPath], {
    cwd: process.cwd(),
    env: { ...process.env, TRAVEL_DATABASE_PATH: databasePath, TRAVEL_SYSTEM_ADMINISTRATOR_ID: "system-admin", TRAVEL_EXTRACTION_ADAPTER: "fake" },
    encoding: "utf8",
  });
  const result = JSON.parse(output) as { itemCount: number; outcome: string; draftId: string };
  assert.equal(result.itemCount, 3);
  assert.equal(result.outcome, "created");
  const previewOutput = execFileSync(process.execPath, ["--experimental-strip-types", "src/import-itinerary.ts", trip.id, "preview-table-v1", markdownPath, "--preview", "--json"], {
    cwd: process.cwd(),
    env: { ...process.env, TRAVEL_DATABASE_PATH: databasePath, TRAVEL_SYSTEM_ADMINISTRATOR_ID: "system-admin", TRAVEL_EXTRACTION_ADAPTER: "fake" },
    encoding: "utf8",
  });
  const preview = JSON.parse(previewOutput) as { itemCount: number; validationIssues: unknown[]; intendedWrites: { confirmedTripItems: number; provisionalProposals: number; decisions: number } };
  assert.equal(preview.itemCount, 3);
  assert.equal(preview.validationIssues.length, 0);
  assert.deepEqual(preview.intendedWrites, { confirmedTripItems: 1, provisionalProposals: 1, decisions: 1, openDecisionProposals: 1 });
  const confirmationOutput = execFileSync(process.execPath, ["--experimental-strip-types", "src/confirm-trip-draft.ts", trip.id, result.draftId, "system-admin"], {
    cwd: process.cwd(),
    env: { ...process.env, TRAVEL_DATABASE_PATH: databasePath, TRAVEL_SYSTEM_ADMINISTRATOR_ID: "system-admin" },
    encoding: "utf8",
  });
  const confirmation = JSON.parse(confirmationOutput) as { status: string; tripItemIds: string[]; proposalIds: string[]; decisionIds: string[] };
  assert.equal(confirmation.status, "confirmed");
  assert.equal(confirmation.tripItemIds.length, 1);
  assert.equal(confirmation.proposalIds.length, 2);
  assert.equal(confirmation.decisionIds.length, 1);
  rmSync(directory, { recursive: true, force: true });
});
