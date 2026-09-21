export type LocationConfidence = "high" | "low";
export type LocationSource = "registry" | "unresolved";

export interface NormalizedLocation {
  city?: string;
  region?: string;
  country?: string;
  macroRegion?: string;
  source: LocationSource;
  confidence: LocationConfidence;
}

export type LocationQueryDimension = { city?: string; region?: string; country?: string; macroRegion?: string };

export interface LocationAlias { alias: string; canonical: string; }

export const LOCATION_ALIASES: readonly LocationAlias[] = [
  { alias: "馬蹄灣", canonical: "Horseshoe Bend" },
  { alias: "羚羊谷", canonical: "Lower Antelope Canyon" },
  { alias: "下羚羊谷", canonical: "Lower Antelope Canyon" },
  { alias: "大峽谷", canonical: "Grand Canyon" },
  { alias: "Mather Point", canonical: "Mather Point" },
  { alias: "Yavapai Point", canonical: "Yavapai Point" },
  { alias: "Desert View Watchtower", canonical: "Desert View Watchtower" },
  { alias: "Cameron Trading Post", canonical: "Cameron Trading Post" },
  { alias: "Mr. D'z Route 66 Diner", canonical: "Mr. D'z Route 66 Diner" },
  { alias: "McCarran Rent-A-Car Center", canonical: "McCarran Rent-A-Car Center" },
];

interface RegistryEntry extends Required<Omit<NormalizedLocation, "source" | "confidence">> {
  aliases: string[];
}

const ENTRIES: RegistryEntry[] = [
  { aliases: ["page", "羚羊谷", "下羚羊谷", "lower antelope canyon", "horseshoe bend", "馬蹄灣"], city: "Page", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { aliases: ["grand canyon village", "grand canyon", "大峽谷村", "大峽谷"], city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { aliases: ["mather point", "yavapai point", "desert view watchtower", "market plaza", "hermits route"], city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { aliases: ["cameron trading post", "cameron"], city: "Cameron", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { aliases: ["tusayan"], city: "Tusayan", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { aliases: ["las vegas", "vegas", "拉斯維加斯"], city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { aliases: ["barstow"], city: "Barstow", region: "California", country: "United States", macroRegion: "US-West" },
  { aliases: ["ludlow"], city: "Ludlow", region: "California", country: "United States", macroRegion: "US-West" },
  { aliases: ["seligman"], city: "Seligman", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { aliases: ["kingman", "mr. d'z route 66 diner"], city: "Kingman", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { aliases: ["los angeles"], city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West" },
  { aliases: ["mccarran rent-a-car center", "harry reid rent-a-car center", "mccarran"], city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
];

const QUERY_DIMENSIONS: Array<{ aliases: string[]; value: LocationQueryDimension }> = [
  { aliases: ["grand canyon village"], value: { city: "Grand Canyon Village" } },
  { aliases: ["page", "佩吉"], value: { city: "Page" } },
  { aliases: ["las vegas", "vegas", "拉斯維加斯"], value: { city: "Las Vegas" } },
  { aliases: ["tusayan"], value: { city: "Tusayan" } },
  { aliases: ["arizona", "亞利桑那"], value: { region: "Arizona" } },
  { aliases: ["nevada", "內華達"], value: { region: "Nevada" } },
  { aliases: ["california", "加州", "加利福尼亞"], value: { region: "California" } },
  { aliases: ["united states", "美國", "美利堅"], value: { country: "United States" } },
  { aliases: ["美西", "美國西部", "us-west"], value: { macroRegion: "US-West" } },
];

function clean(value: string): string { return value.trim().toLocaleLowerCase(); }

export function normalizeLocation(value: string | null | undefined): NormalizedLocation | null {
  if (!value?.trim()) return null;
  const normalized = clean(value);
  const entry = ENTRIES.find((candidate) => candidate.aliases.some((alias) => normalized === alias || normalized.includes(alias)));
  if (!entry) return { source: "unresolved", confidence: "low" };
  return { city: entry.city, region: entry.region, country: entry.country, macroRegion: entry.macroRegion, source: "registry", confidence: "high" };
}

export function normalizeLocationQueryDimension(value: string): LocationQueryDimension | null {
  const normalized = clean(value);
  return QUERY_DIMENSIONS.find((entry) => entry.aliases.some((alias) => normalized.includes(alias)))?.value ?? null;
}

export function normalizeItemLocations(item: { location?: string | null; origin?: string | null; destination?: string | null }): { location?: NormalizedLocation; origin?: NormalizedLocation; destination?: NormalizedLocation } {
  const location = normalizeLocation(item.location); const origin = normalizeLocation(item.origin); const destination = normalizeLocation(item.destination);
  return { ...(location ? { location } : {}), ...(origin ? { origin } : {}), ...(destination ? { destination } : {}) };
}
