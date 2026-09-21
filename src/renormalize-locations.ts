import { TravelDatabase } from "./database.ts";
import { NotFoundError, TravelService } from "./travel-service.ts";

const [tripId, ...flags] = process.argv.slice(2);
const databasePath = process.env.TRAVEL_DATABASE_PATH?.trim() || "./data/travel.sqlite";

if (!tripId?.trim()) {
  process.stderr.write("Usage: npm run normalize:locations -- <trip-id> [--context] [--json]\n");
  process.exitCode = 1;
} else {
  const database = new TravelDatabase(databasePath);
  try {
    const travel = new TravelService(database, process.env.TRAVEL_SYSTEM_ADMINISTRATOR_ID?.trim() || "system-admin");
    if (!travel.getTrip(tripId.trim())) throw new NotFoundError(`Trip ${tripId} was not found.`);
    const result = travel.renormalizeTripLocations(tripId.trim(), { contextual: flags.includes("--context") });
    process.stdout.write(flags.includes("--json") ? `${JSON.stringify(result)}\n` : `已重新正規化 Trip ${result.tripId}：Proposals ${result.proposals} 筆、Trip Items ${result.tripItems} 筆、變更 ${result.changed} 筆。\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    database.close();
  }
}
