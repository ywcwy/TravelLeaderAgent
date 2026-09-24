export type LocationConfidence = "high" | "low";
export type LocationSource = "registry" | "unresolved";
export type LocationKind = "city" | "landmark" | "business" | "address-like";
export type LocationRegistryEntryStatus = "active" | "inactive";

export interface NormalizedLocation {
  canonicalId?: string;
  canonicalName?: string;
  kind?: LocationKind;
  city?: string;
  region?: string;
  country?: string;
  macroRegion?: string;
  source: LocationSource;
  confidence: LocationConfidence;
}

export interface LocationRegistryEntry {
  canonicalId: string;
  canonicalName: string;
  aliases: readonly string[];
  kind: LocationKind;
  /** Inactive entries remain addressable by canonical ID, but never resolve new source text. */
  status?: LocationRegistryEntryStatus;
  city?: string;
  region?: string;
  country?: string;
  macroRegion?: string;
}

/** Bump whenever approved aliases, hierarchy, or lifecycle state changes. */
export const LOCATION_REGISTRY_VERSION = "location-registry-v6";

export const LOCATION_REGISTRY: readonly LocationRegistryEntry[] = [
  { canonicalId: "city:page-us", canonicalName: "Page", aliases: ["page", "佩吉"], kind: "city", city: "Page", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:lower-antelope-canyon-page-us", canonicalName: "Lower Antelope Canyon", aliases: ["lower antelope canyon", "下羚羊谷", "羚羊谷"], kind: "landmark", city: "Page", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:horseshoe-bend-page-us", canonicalName: "Horseshoe Bend", aliases: ["horseshoe bend", "馬蹄灣"], kind: "landmark", city: "Page", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:grand-canyon-village-us", canonicalName: "Grand Canyon Village", aliases: ["grand canyon village", "grand canyon", "大峽谷村", "大峽谷"], kind: "city", city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:grand-canyon-visitor-center-us", canonicalName: "Grand Canyon Visitor Center", aliases: ["grand canyon visitor center"], kind: "landmark", city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:grand-canyon-national-park-us", canonicalName: "Grand Canyon National Park", aliases: ["grand canyon national park", "大峽谷國家公園"], kind: "landmark", city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:mather-point-grand-canyon-us", canonicalName: "Mather Point", aliases: ["mather point"], kind: "landmark", city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:yavapai-point-grand-canyon-us", canonicalName: "Yavapai Point", aliases: ["yavapai point"], kind: "landmark", city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:desert-view-watchtower-grand-canyon-us", canonicalName: "Desert View Watchtower", aliases: ["desert view watchtower"], kind: "landmark", city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:market-plaza-grand-canyon-us", canonicalName: "Market Plaza", aliases: ["market plaza"], kind: "landmark", city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:hermits-route-grand-canyon-us", canonicalName: "Hermits Route", aliases: ["hermits route", "紅線 hermits route"], kind: "landmark", city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:hopi-point-grand-canyon-us", canonicalName: "Hopi Point", aliases: ["hopi point"], kind: "landmark", city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:powell-point-grand-canyon-us", canonicalName: "Powell Point", aliases: ["powell point"], kind: "landmark", city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:hermits-rest-grand-canyon-us", canonicalName: "Hermit's Rest", aliases: ["hermit's rest", "hermit’s rest", "隱士休息區"], kind: "landmark", city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:trail-view-overlook-grand-canyon-us", canonicalName: "Trail View Overlook", aliases: ["trail view overlook"], kind: "landmark", city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:cameron-us", canonicalName: "Cameron", aliases: ["cameron"], kind: "city", city: "Cameron", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:cameron-trading-post-us", canonicalName: "Cameron Trading Post", aliases: ["cameron trading post"], kind: "business", city: "Cameron", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:kanab-us", canonicalName: "Kanab", aliases: ["kanab", "卡納布"], kind: "city", city: "Kanab", region: "Utah", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:st-george-us", canonicalName: "St. George", aliases: ["st. george", "saint george"], kind: "city", city: "St. George", region: "Utah", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:williams-us", canonicalName: "Williams", aliases: ["williams", "williams az"], kind: "city", city: "Williams", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:tusayan-us", canonicalName: "Tusayan", aliases: ["tusayan"], kind: "city", city: "Tusayan", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:las-vegas-us", canonicalName: "Las Vegas", aliases: ["las vegas", "vegas", "拉斯維加斯"], kind: "city", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:barstow-us", canonicalName: "Barstow", aliases: ["barstow"], kind: "city", city: "Barstow", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:ludlow-us", canonicalName: "Ludlow", aliases: ["ludlow"], kind: "city", city: "Ludlow", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:seligman-us", canonicalName: "Seligman", aliases: ["seligman"], kind: "city", city: "Seligman", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:kingman-us", canonicalName: "Kingman", aliases: ["kingman"], kind: "city", city: "Kingman", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:mr-dz-route-66-diner-kingman-us", canonicalName: "Mr. D'z Route 66 Diner", aliases: ["mr. d'z route 66 diner", "mr d'z route 66 diner"], kind: "business", city: "Kingman", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:delgadillos-snow-cap-seligman-us", canonicalName: "Delgadillo's Snow Cap", aliases: ["delgadillo's snow cap", "delgadillo’s snow cap", "delgadillos snow cap"], kind: "business", city: "Seligman", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:safeway-williams-us", canonicalName: "Safeway Williams", aliases: ["safeway williams", "safeway 超市（williams, az）", "safeway supermarket williams"], kind: "business", city: "Williams", region: "Arizona", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:los-angeles-us", canonicalName: "Los Angeles", aliases: ["los angeles", "la"], kind: "city", city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:mccarran-rent-a-car-center-las-vegas-us", canonicalName: "McCarran Rent-A-Car Center", aliases: ["mccarran rent-a-car center", "harry reid rent-a-car center", "mccarran", "rent-a-car center"], kind: "business", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "airport:taiwan-taoyuan-international-tpe", canonicalName: "Taiwan Taoyuan International Airport", aliases: ["tpe", "taoyuan international airport", "taoyuan airport"], kind: "address-like", city: "Taipei", region: "Taipei", country: "Taiwan", macroRegion: "East-Asia" },
  { canonicalId: "airport:san-francisco-international-sfo", canonicalName: "San Francisco International Airport", aliases: ["sfo", "san francisco international airport"], kind: "address-like", city: "San Francisco", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:san-francisco-us", canonicalName: "San Francisco", aliases: ["san francisco", "sf"], kind: "city", city: "San Francisco", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:hyatt-regency-san-francisco-downtown-soma-us", canonicalName: "Hyatt Regency San Francisco Downtown SOMA", aliases: ["hyatt regency san francisco downtown soma"], kind: "business", city: "San Francisco", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:fog-harbor-fish-house-san-francisco-us", canonicalName: "Fog Harbor Fish House", aliases: ["fog harbor fish house"], kind: "business", city: "San Francisco", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:north-beach-san-francisco-us", canonicalName: "North Beach", aliases: ["north beach"], kind: "landmark", city: "San Francisco", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:china-basin-park-san-francisco-us", canonicalName: "China Basin Park", aliases: ["china basin park"], kind: "landmark", city: "San Francisco", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:oracle-park-san-francisco-us", canonicalName: "Oracle Park", aliases: ["oracle park"], kind: "landmark", city: "San Francisco", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:palm-court-rh-san-francisco-us", canonicalName: "The Palm Court @ RH San Francisco", aliases: ["the palm court @ rh san francisco", "the palm court rh san francisco"], kind: "business", city: "San Francisco", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:golden-gate-bridge-us", canonicalName: "Golden Gate Bridge", aliases: ["golden gate bridge"], kind: "landmark", city: "San Francisco", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:sausalito-us", canonicalName: "Sausalito", aliases: ["sausalito"], kind: "city", city: "Sausalito", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:the-spinnaker-sausalito-us", canonicalName: "The Spinnaker", aliases: ["the spinnaker"], kind: "business", city: "Sausalito", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:napa-us", canonicalName: "Napa", aliases: ["napa"], kind: "city", city: "Napa", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:oxbow-market-napa-us", canonicalName: "Oxbow Market", aliases: ["oxbow market"], kind: "landmark", city: "Napa", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:bouchon-bakery-napa-us", canonicalName: "Bouchon Bakery", aliases: ["bouchon bakery"], kind: "business", city: "Napa", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:pride-mountain-vineyards-st-helena-us", canonicalName: "Pride Mountain Vineyards", aliases: ["pride mountain vineyards"], kind: "business", city: "St. Helena", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:st-helena-us", canonicalName: "St. Helena", aliases: ["st. helena", "saint helena"], kind: "city", city: "St. Helena", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:st-helena-downtown-us", canonicalName: "St. Helena Downtown", aliases: ["st. helena downtown"], kind: "landmark", city: "St. Helena", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:zuzu-napa-us", canonicalName: "Zuzu", aliases: ["zuzu"], kind: "business", city: "Napa", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "airport:harry-reid-international-las-vegas-us", canonicalName: "Harry Reid International Airport", aliases: ["las vegas airport", "las vegas international airport", "las airport", "las"], kind: "address-like", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "airport:los-angeles-international-lax-us", canonicalName: "Los Angeles International Airport", aliases: ["lax", "los angeles airport", "los angeles international airport"], kind: "address-like", city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:mgm-grand-las-vegas-us", canonicalName: "MGM Grand", aliases: ["mgm grand"], kind: "business", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:target-showcase-mall-las-vegas-us", canonicalName: "Target at Showcase Mall", aliases: ["target at showcase mall"], kind: "business", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:bavettes-steakhouse-park-mgm-las-vegas-us", canonicalName: "Bavette's Steakhouse & Bar", aliases: ["bavette's steakhouse & bar", "bavette's at park mgm"], kind: "business", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:park-mgm-las-vegas-us", canonicalName: "Park MGM", aliases: ["park mgm"], kind: "business", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:marquee-nightclub-las-vegas-us", canonicalName: "Marquee Nightclub", aliases: ["marquee nightclub"], kind: "business", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:flamingo-caesars-palace-station-las-vegas-us", canonicalName: "Flamingo/Caesars Palace Station", aliases: ["flamingo/caesars palace station"], kind: "landmark", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:hells-kitchen-caesars-palace-las-vegas-us", canonicalName: "Hell's Kitchen", aliases: ["hell's kitchen"], kind: "business", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:caesars-palace-forum-shops-las-vegas-us", canonicalName: "Caesars Palace and Forum Shops", aliases: ["caesars palace and forum shops"], kind: "landmark", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:caesars-palace-las-vegas-us", canonicalName: "Caesars Palace", aliases: ["caesars palace"], kind: "business", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:fremont-east-las-vegas-us", canonicalName: "Fremont East", aliases: ["fremont east"], kind: "landmark", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:fremont-street-experience-las-vegas-us", canonicalName: "Fremont Street Experience", aliases: ["fremont street experience"], kind: "landmark", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:omnia-nightclub-las-vegas-us", canonicalName: "OMNIA Nightclub", aliases: ["omnia nightclub"], kind: "business", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:tableau-wynn-las-vegas-us", canonicalName: "Tableau", aliases: ["tableau", "tableau at wynn"], kind: "business", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:bellagio-conservatory-las-vegas-us", canonicalName: "Bellagio Conservatory & Botanical Gardens", aliases: ["bellagio conservatory & botanical gardens"], kind: "landmark", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:lago-julian-serrano-las-vegas-us", canonicalName: "LAGO by Julian Serrano", aliases: ["lago by julian serrano"], kind: "business", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:fountains-of-bellagio-las-vegas-us", canonicalName: "Fountains of Bellagio", aliases: ["fountains of bellagio"], kind: "landmark", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:o-theatre-bellagio-las-vegas-us", canonicalName: "O Theatre", aliases: ["o theatre", "o by cirque du soleil"], kind: "landmark", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:bouchon-las-vegas-us", canonicalName: "Bouchon", aliases: ["bouchon"], kind: "business", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West" },
  { canonicalId: "resort:disneyland-resort-anaheim-us", canonicalName: "Disneyland Resort", aliases: ["disneyland resort", "disneyland"], kind: "landmark", city: "Anaheim", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:disneyland-hotel-anaheim-us", canonicalName: "Disneyland Hotel", aliases: ["disneyland hotel"], kind: "business", city: "Anaheim", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:jw-marriott-anaheim-resort-us", canonicalName: "JW Marriott Anaheim Resort", aliases: ["jw marriott anaheim resort", "jw marriott anaheim"], kind: "business", city: "Anaheim", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "resort:universal-studios-hollywood-us", canonicalName: "Universal Studios Hollywood", aliases: ["universal studios hollywood", "halloween horror nights hollywood"], kind: "landmark", city: "Universal City", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:hollywood-sign-los-angeles-us", canonicalName: "Hollywood Sign", aliases: ["hollywood sign"], kind: "landmark", city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:griffith-observatory-los-angeles-us", canonicalName: "Griffith Observatory", aliases: ["griffith observatory"], kind: "landmark", city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:hollywood-walk-of-fame-los-angeles-us", canonicalName: "Hollywood Walk of Fame", aliases: ["hollywood walk of fame"], kind: "landmark", city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:farmers-market-the-grove-los-angeles-us", canonicalName: "The Original Farmers Market and The Grove", aliases: ["the original farmers market and the grove", "the grove"], kind: "landmark", city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:santa-monica-us", canonicalName: "Santa Monica", aliases: ["santa monica"], kind: "city", city: "Santa Monica", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:santa-monica-pier-us", canonicalName: "Santa Monica Pier", aliases: ["santa monica pier"], kind: "landmark", city: "Santa Monica", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:paul-smith-pink-wall-los-angeles-us", canonicalName: "Paul Smith Pink Wall", aliases: ["paul smith pink wall"], kind: "landmark", city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:grand-central-market-los-angeles-us", canonicalName: "Grand Central Market", aliases: ["grand central market"], kind: "landmark", city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:citadel-outlets-commerce-us", canonicalName: "Citadel Outlets", aliases: ["citadel outlets"], kind: "landmark", city: "Commerce", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "business:chipotle-los-angeles-us", canonicalName: "Chipotle", aliases: ["chipotle"], kind: "business", city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:warner-bros-studio-tour-hollywood-us", canonicalName: "Warner Bros. Studio Tour Hollywood", aliases: ["warner bros. studio tour hollywood"], kind: "landmark", city: "Burbank", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "landmark:little-tokyo-los-angeles-us", canonicalName: "Little Tokyo", aliases: ["little tokyo"], kind: "landmark", city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West" },
  { canonicalId: "city:springfield-il-us", canonicalName: "Springfield", aliases: ["springfield"], kind: "city", city: "Springfield", region: "Illinois", country: "United States", macroRegion: "US" },
  { canonicalId: "city:springfield-mo-us", canonicalName: "Springfield", aliases: ["springfield"], kind: "city", city: "Springfield", region: "Missouri", country: "United States", macroRegion: "US" },
];

export type LocationQueryDimension = { city?: string; region?: string; country?: string; macroRegion?: string };
export interface LocationAlias { alias: string; canonical: string; }
export function isActiveRegistryEntry(entry: LocationRegistryEntry): boolean { return entry.status !== "inactive"; }

/** Includes inactive entries so persisted canonical IDs remain interpretable after retirement. */
export function findLocationRegistryEntry(canonicalId: string, registry: readonly LocationRegistryEntry[] = LOCATION_REGISTRY): LocationRegistryEntry | undefined {
  return registry.find((entry) => entry.canonicalId === canonicalId);
}

export const LOCATION_ALIASES: readonly LocationAlias[] = LOCATION_REGISTRY
  .filter(isActiveRegistryEntry)
  .flatMap((entry) => entry.aliases.map((alias) => ({ alias, canonical: entry.canonicalName })));

const QUERY_DIMENSIONS: Array<{ aliases: string[]; value: LocationQueryDimension }> = [
  { aliases: ["grand canyon village"], value: { city: "Grand Canyon Village" } }, { aliases: ["page", "佩吉"], value: { city: "Page" } },
  { aliases: ["las vegas", "vegas", "拉斯維加斯"], value: { city: "Las Vegas" } }, { aliases: ["tusayan"], value: { city: "Tusayan" } },
  { aliases: ["kanab", "卡納布"], value: { city: "Kanab" } }, { aliases: ["st. george", "saint george"], value: { city: "St. George" } }, { aliases: ["williams", "williams az"], value: { city: "Williams" } },
  { aliases: ["arizona", "亞利桑那"], value: { region: "Arizona" } }, { aliases: ["nevada", "內華達"], value: { region: "Nevada" } },
  { aliases: ["california", "加州", "加利福尼亞"], value: { region: "California" } }, { aliases: ["united states", "美國", "美利堅"], value: { country: "United States" } },
  { aliases: ["美西", "美國西部", "us-west"], value: { macroRegion: "US-West" } },
];

function clean(value: string): string { return value.trim().toLocaleLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " "); }
function matchesPhrase(value: string, alias: string): boolean {
  const haystack = clean(value); const needle = clean(alias); if (!needle) return false;
  if (/[^\x00-\x7F]/.test(needle)) return haystack.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(haystack);
}
function toNormalized(entry: LocationRegistryEntry): NormalizedLocation { return { canonicalId: entry.canonicalId, canonicalName: entry.canonicalName, kind: entry.kind, city: entry.city, region: entry.region, country: entry.country, macroRegion: entry.macroRegion, source: "registry", confidence: "high" }; }

export type LocationResolution = { status: "resolved"; location: NormalizedLocation; candidates?: readonly NormalizedLocation[] } | { status: "ambiguous"; candidates: readonly NormalizedLocation[] } | { status: "unresolved"; candidates?: readonly NormalizedLocation[] };
export function resolveLocationCandidates(value: string | null | undefined, registry: readonly LocationRegistryEntry[] = LOCATION_REGISTRY): LocationResolution {
  if (!value?.trim()) return { status: "unresolved" };
  const matched = registry.filter(isActiveRegistryEntry).flatMap((entry) => entry.aliases.filter((alias) => matchesPhrase(value, alias)).map((alias) => ({ entry, alias })));
  const matches = matched.filter(({ alias }) => !matched.some((other) => other.alias !== alias && other.alias.length > alias.length && matchesPhrase(other.alias, alias))).map(({ entry }) => entry);
  const uniqueMatches = [...new Map(matches.map((entry) => [entry.canonicalId, entry])).values()];
  const sharedCity = uniqueMatches.length > 1 && uniqueMatches.every((entry) => entry.city) && new Set(uniqueMatches.map((entry) => entry.city)).size === 1;
  const specificMatches = sharedCity ? uniqueMatches.filter((entry) => entry.kind !== "city") : uniqueMatches;
  if (specificMatches.length === 1) return { status: "resolved", location: toNormalized(specificMatches[0]!) };
  if (uniqueMatches.length === 0) return { status: "unresolved" }; if (uniqueMatches.length > 1) return { status: "ambiguous", candidates: uniqueMatches.map(toNormalized) }; return { status: "resolved", location: toNormalized(uniqueMatches[0]) };
}
export function normalizeLocation(value: string | null | undefined, registry: readonly LocationRegistryEntry[] = LOCATION_REGISTRY): NormalizedLocation | null {
  if (!value?.trim()) return null; const resolution = resolveLocationCandidates(value, registry); return resolution.status === "resolved" ? resolution.location : { source: "unresolved", confidence: "low" };
}
export function normalizeLocationQueryDimension(value: string): LocationQueryDimension | null {
  const normalized = clean(value); return QUERY_DIMENSIONS.find((entry) => entry.aliases.some((alias) => matchesPhrase(normalized, alias)))?.value ?? null;
}
export function normalizeItemLocations(item: { location?: string | null; origin?: string | null; destination?: string | null }): { location?: NormalizedLocation; origin?: NormalizedLocation; destination?: NormalizedLocation } {
  const location = normalizeLocation(item.location); const origin = normalizeLocation(item.origin); const destination = normalizeLocation(item.destination); return { ...(location ? { location } : {}), ...(origin ? { origin } : {}), ...(destination ? { destination } : {}) };
}
export function formatLocationCandidates(candidates: readonly NormalizedLocation[]): string { return candidates.map((candidate) => `- ${candidate.canonicalName}｜${candidate.city ?? ""}｜${candidate.region ?? ""}｜${candidate.country ?? ""}`).join("\n"); }

export interface LocationInventoryEntry {
  value: string;
  occurrences: number;
  references: Array<{ type: "proposal" | "trip_item"; id: string; field: "location" | "origin" | "destination" }>;
  candidates: string[];
}

export function buildLocationInventory(items: ReadonlyArray<{ id: string; type: "proposal" | "trip_item"; location?: string | null; origin?: string | null; destination?: string | null }>): LocationInventoryEntry[] {
  const inventory = new Map<string, LocationInventoryEntry>();
  for (const item of items) {
    for (const [field, value] of [["location", item.location], ["origin", item.origin], ["destination", item.destination]] as const) {
      const text = value?.trim();
      if (!text) continue;
      const resolution = resolveLocationCandidates(text);
      if (resolution.status === "resolved") continue;
      const entry: LocationInventoryEntry = inventory.get(text) ?? { value: text, occurrences: 0, references: [], candidates: resolution.status === "ambiguous" ? resolution.candidates.map((candidate) => candidate.canonicalName).filter((candidate): candidate is string => Boolean(candidate)) : [] };
      entry.occurrences += 1;
      const reference = { type: item.type, id: item.id, field };
      if (!entry.references.some((current) => current.type === reference.type && current.id === reference.id && current.field === reference.field)) entry.references.push(reference);
      inventory.set(text, entry);
    }
  }
  return [...inventory.values()].sort((left, right) => left.value.localeCompare(right.value));
}

const CONTEXT_LOCATION_RESOLVER_VERSION = "context-location-v1";
const SEMANTIC_LOCATION_ROLE = /^(?:住宿|飯店|酒店|旅館|hotel|lodging|stay|吃早餐|早餐|breakfast|途中休息|休息|rest(?:\s+stop)?|stop\s+for\s+a\s+break)$/iu;

export function isSemanticLocationRole(value: string | null | undefined): boolean {
  return Boolean(value?.trim() && SEMANTIC_LOCATION_ROLE.test(value.trim()));
}

/** Applies only unambiguous, coarse geography from nearby explicit itinerary anchors. */
export function inferContextualLocations<T extends ExtractedTripItem>(items: readonly T[]): T[] {
  const anchors = items.map((item, index) => ({ item, index, location: normalizeLocation(item.location) }))
    .filter((entry): entry is { item: T; index: number; location: NormalizedLocation } => entry.location?.source === "registry" && Boolean(entry.location.city));
  return items.map((item, index) => {
    const canInfer = !item.location || /^(?:住宿|飯店|酒店|旅館|hotel|lodging|stay)$/iu.test(item.location.trim());
    if (item.shape === "route" || !canInfer) return { ...item };
    const nearby = anchors.filter((anchor) => {
      if (item.localDate && anchor.item.localDate) {
        if (Math.abs(anchor.index - index) > 2) return false;
      } else if (Math.abs(anchor.index - index) <= 2) {
        return true;
      } else {
        return false;
      }
      const target = Date.parse(`${item.localDate}T00:00:00Z`);
      const candidate = Date.parse(`${anchor.item.localDate}T00:00:00Z`);
      return Math.abs(target - candidate) <= 24 * 60 * 60 * 1000;
    });
    const cities = [...new Set(nearby.map((anchor) => anchor.location.city).filter((city): city is string => Boolean(city)))];
    if (cities.length !== 1) return { ...item };
    const cityEntry = LOCATION_REGISTRY.find((entry) => entry.kind === "city" && entry.city === cities[0]);
    if (!cityEntry) return { ...item };
    const evidence = nearby.map((anchor) => `sourceLine:${anchor.item.sourceLine ?? anchor.index + 1}`);
    return {
      ...item,
      city: cityEntry.city,
      region: cityEntry.region,
      country: cityEntry.country,
      macroRegion: cityEntry.macroRegion,
      locationSource: "unresolved",
      locationConfidence: "low",
      locationProvenance: "context_inferred",
      locationInferenceEvidence: evidence,
      locationResolverVersion: CONTEXT_LOCATION_RESOLVER_VERSION,
    };
  });
}
import type { ExtractedTripItem } from "./domain.ts";
