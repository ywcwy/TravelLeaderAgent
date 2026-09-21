import type { ItineraryQuery } from "./domain.ts";
import { LOCATION_ALIASES, resolveLocationCandidates } from "./location-normalization.ts";
export { LOCATION_ALIASES } from "./location-normalization.ts";

export class LocationAmbiguityError extends Error {
  readonly candidates;
  constructor(candidates: readonly import("./location-normalization.ts").NormalizedLocation[]) {
    super("Location is ambiguous.");
    this.name = "LocationAmbiguityError";
    this.candidates = candidates;
  }
}

/** Versioned, deterministic aliases. User-facing aliases never overwrite evidence. */
export function normalizeLocationQuery(value: string): string {
  if (["grand canyon", "大峽谷"].includes(value.trim().toLocaleLowerCase())) return "Grand Canyon";
  const resolution = resolveLocationCandidates(value);
  if (resolution.status === "resolved") return resolution.location.canonicalName ?? value.trim();
  const normalized = value.trim().toLocaleLowerCase();
  const alias = LOCATION_ALIASES.find((candidate) => normalized === candidate.alias.toLocaleLowerCase() || normalized === candidate.canonical.toLocaleLowerCase());
  return alias?.canonical ?? value.trim();
}

export function normalizeItineraryQuery(query: ItineraryQuery): ItineraryQuery {
  for (const value of [query.location, query.origin, query.destination]) {
    if (!value) continue;
    const resolution = resolveLocationCandidates(value);
    if (resolution.status === "ambiguous") throw new LocationAmbiguityError(resolution.candidates);
  }
  const macroRegion = query.macroRegion ?? (query.location && /^(?:美西|美國西部|us[- ]?west)$/i.test(query.location.trim()) ? "US-West" : undefined);
  const isMacroOnlyLocation = Boolean(query.location && macroRegion && /^(?:美西|美國西部|us[- ]?west)$/i.test(query.location.trim()));
  return {
    ...query,
    ...(query.location && !isMacroOnlyLocation ? { location: normalizeLocationQuery(query.location) } : {}),
    ...(query.origin ? { origin: normalizeLocationQuery(query.origin) } : {}),
    ...(query.destination ? { destination: normalizeLocationQuery(query.destination) } : {}),
    ...(macroRegion ? { macroRegion } : {}),
  };
}

export function displayLocationAlias(value: string, preferredAlias?: string): string {
  if (!preferredAlias) return value;
  const canonical = normalizeLocationQuery(preferredAlias).toLocaleLowerCase();
  return normalizeLocationQuery(value).toLocaleLowerCase() === canonical ? preferredAlias : value;
}

export function locationValueMatchesQuery(value: string, queryLocation: string): boolean {
  const valueResolution = resolveLocationCandidates(value);
  const queryResolution = resolveLocationCandidates(queryLocation);
  if (valueResolution.status === "resolved" && queryResolution.status === "resolved") {
    return valueResolution.location.canonicalId === queryResolution.location.canonicalId || valueResolution.location.city === queryResolution.location.city;
  }
  return value.trim().toLocaleLowerCase() === queryLocation.trim().toLocaleLowerCase();
}
