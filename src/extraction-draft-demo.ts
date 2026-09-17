import { FakeLlmAdapter, renderExtractionDraft } from "./extraction-draft.ts";
import { TravelDatabase } from "./database.ts";
import type { ExtractionDraftPayload } from "./domain.ts";
import { TravelService } from "./travel-service.ts";

const source = "10/1 晚上到 Page，入住 Holiday Inn Express。";
const fixture: ExtractionDraftPayload = {
  items: [{
    kind: "lodging",
    kinds: ["lodging"],
    shape: "point",
    shapeSource: "inferred",
    title: "入住 Holiday Inn Express",
    status: "provisional",
    startsAt: "2026-10-01",
    startTimeFlexibility: "flexible",
    endTimeFlexibility: "flexible",
    timeWindow: "evening",
    location: "Page",
    sourceExcerpt: source,
  }],
  missing: [],
  assumptions: ["以 Trip Timezone 解讀 10/1。"],
  issues: [],
  sourceExcerpt: source,
};

const db = new TravelDatabase();
const travel = new TravelService(db, "system-admin");
const group = travel.createTravelGroup("system-admin", "demo-extraction-draft", "Draft Demo");
const trip = travel.createActiveTrip("system-admin", group.id, "Draft Demo Trip", "Asia/Taipei");
const adapter = new FakeLlmAdapter({ [source]: fixture });
const draft = await travel.createExtractionDraft(trip.id, source, { idempotencyKey: "demo:draft:1", type: "line_text", currentDate: "2026-09-17" }, adapter);

console.log(renderExtractionDraft(draft));
console.log(JSON.stringify({ draftId: draft.id, status: draft.status, sourceId: draft.sourceId, proposalCount: db.connection.prepare("SELECT COUNT(*) AS count FROM proposals WHERE trip_id = ?").get(trip.id) }, null, 2));
db.close();
