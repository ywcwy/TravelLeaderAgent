import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { TravelDatabase } from "./database.ts";
import { TravelService } from "./travel-service.ts";

const args = process.argv.slice(2);
const tripId = args.find((arg) => !arg.startsWith("--"));
const positional = args.filter((arg) => arg !== "--confirm").slice(1);
const administratorId = process.env.TRAVEL_SYSTEM_ADMINISTRATOR_ID?.trim() || "system-admin";
const databasePath = process.env.TRAVEL_DATABASE_PATH?.trim() || "./data/travel.sqlite";

if (!tripId?.trim() || !args.includes("--confirm")) {
  process.stderr.write("Usage: npm run reset:trip -- <trip-id> --confirm [title] [timezone]\n");
  process.exitCode = 1;
} else {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const database = new TravelDatabase(databasePath);
  try {
    const travel = new TravelService(database, administratorId);
    const result = travel.resetActiveTrip(administratorId, tripId.trim(), { title: positional[0], timezone: positional[1] });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    database.close();
  }
}
