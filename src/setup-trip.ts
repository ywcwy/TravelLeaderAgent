import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { TravelDatabase } from "./database.ts";
import { TravelService } from "./travel-service.ts";

const [lineGroupId, title = "LINE 測試旅程", timezone = "Asia/Taipei"] = process.argv.slice(2);
const administratorId = process.env.TRAVEL_SYSTEM_ADMINISTRATOR_ID?.trim() || "system-admin";

if (!lineGroupId?.trim()) {
  process.stderr.write("Usage: npm run setup:trip -- <line-group-id> [title] [timezone]\n");
  process.exitCode = 1;
} else {
  const databasePath = process.env.TRAVEL_DATABASE_PATH?.trim() || "./data/travel.sqlite";
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const database = new TravelDatabase(databasePath);
  try {
    const travel = new TravelService(database, administratorId);
    const group = travel.createTravelGroup(administratorId, lineGroupId.trim(), title);
    const trip = travel.getActiveTripForLineGroup(group.lineGroupId) ?? travel.createActiveTrip(administratorId, group.id, title, timezone);
    process.stdout.write(`${JSON.stringify({ groupId: group.lineGroupId, travelGroupId: group.id, tripId: trip.id, title: trip.title, timezone: trip.timezone })}\n`);
  } finally {
    database.close();
  }
}
