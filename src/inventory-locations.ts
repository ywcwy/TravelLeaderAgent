import { TravelDatabase } from "./database.ts";
import { buildLocationInventory } from "./location-normalization.ts";

const [tripId, ...flags] = process.argv.slice(2);
const databasePath = process.env.TRAVEL_DATABASE_PATH?.trim() || "./data/travel.sqlite";

if (!tripId?.trim()) {
  process.stderr.write("Usage: npm run inventory:locations -- <trip-id> [--json]\n");
  process.exitCode = 1;
} else {
  const database = new TravelDatabase(databasePath, { backfill: false });
  try {
    const proposals = database.connection.prepare("SELECT id, location, origin, destination FROM proposals WHERE trip_id = ?").all(tripId.trim()) as Array<{ id: string; location: string | null; origin: string | null; destination: string | null }>;
    const tripItems = database.connection.prepare("SELECT id, location, origin, destination FROM trip_items WHERE trip_id = ?").all(tripId.trim()) as Array<{ id: string; location: string | null; origin: string | null; destination: string | null }>;
    const inventory = buildLocationInventory([...proposals.map((item) => ({ ...item, type: "proposal" as const })), ...tripItems.map((item) => ({ ...item, type: "trip_item" as const }))]);
    if (flags.includes("--json")) process.stdout.write(`${JSON.stringify({ tripId: tripId.trim(), inventory })}\n`);
    else if (inventory.length === 0) process.stdout.write("沒有 unresolved location。\n");
    else for (const entry of inventory) process.stdout.write(`${entry.value}｜${entry.occurrences} 次｜${entry.references.map((reference) => `${reference.type}:${reference.id}.${reference.field}`).join(", ")}${entry.candidates.length ? `｜候選：${entry.candidates.join(", ")}` : ""}\n`);
  } finally {
    database.close();
  }
}
