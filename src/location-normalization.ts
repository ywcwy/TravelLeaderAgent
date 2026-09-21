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

interface RegistryEntry extends Required<Omit<NormalizedLocation, "source" | "confidence">> {
  aliases: string[];
}

const ENTRIES: RegistryEntry[] = [
  { aliases: ["page", "羚羊谷", "下羚羊谷", "lower antelope canyon", "horseshoe bend", "馬蹄灣"], city: "Page", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { aliases: ["grand canyon village", "grand canyon", "大峽谷村", "大峽谷"], city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { aliases: ["tusayan"], city: "Tusayan", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { aliases: ["las vegas", "vegas", "拉斯維加斯"], city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { aliases: ["barstow"], city: "Barstow", region: "California", country: "United States", macroRegion: "US-West" },
  { aliases: ["ludlow"], city: "Ludlow", region: "California", country: "United States", macroRegion: "US-West" },
  { aliases: ["seligman"], city: "Seligman", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { aliases: ["kingman"], city: "Kingman", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { aliases: ["los angeles"], city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West" },
];

function clean(value: string): string { return value.trim().toLocaleLowerCase().replace(/[,，].*$/u, ""); }

export function normalizeLocation(value: string | null | undefined): NormalizedLocation | null {
  if (!value?.trim()) return null;
  const normalized = clean(value);
  const entry = ENTRIES.find((candidate) => candidate.aliases.some((alias) => normalized === alias || normalized.includes(alias)));
  if (!entry) return { source: "unresolved", confidence: "low" };
  return { city: entry.city, region: entry.region, country: entry.country, macroRegion: entry.macroRegion, source: "registry", confidence: "high" };
}

export function normalizeItemLocations(item: { location?: string | null; origin?: string | null; destination?: string | null }): { location?: NormalizedLocation; origin?: NormalizedLocation; destination?: NormalizedLocation } {
  const location = normalizeLocation(item.location); const origin = normalizeLocation(item.origin); const destination = normalizeLocation(item.destination);
  return { ...(location ? { location } : {}), ...(origin ? { origin } : {}), ...(destination ? { destination } : {}) };
}
