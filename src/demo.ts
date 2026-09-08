import { TravelDatabase } from "./database.ts";
import { TravelService } from "./travel-service.ts";

const db = new TravelDatabase();
const travel = new TravelService(db, "system-admin");
const travelGroup = travel.createTravelGroup("system-admin", "C-west-coast-2026", "2026 美西自駕群");
const tripId = travel.createActiveTrip("system-admin", travelGroup.id, "2026 美西自駕", "America/Los_Angeles").id;
travel.addMember("system-admin", tripId, "U-owner", "Aster", "owner");

const { proposalIds } = travel.importMarkdown(tripId, `
- [confirmed] SFO 抵達 | 2026-10-15T09:30:00-07:00 | SFO
- [open_decision] 10/16 住宿：Carmel 或 Monterey | 2026-10-16T15:00:00-07:00 | Big Sur | 請在 10/01 前確認
`);
travel.confirmProposal(tripId, "U-owner", proposalIds[0]);
console.log(JSON.stringify(travel.reviewTrip(tripId), null, 2));
db.close();
