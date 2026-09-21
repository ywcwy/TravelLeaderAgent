import type { ItineraryQuery } from "./domain.ts";
import { LOCATION_ALIASES } from "./location-normalization.ts";
export { LOCATION_ALIASES } from "./location-normalization.ts";

/** Versioned, deterministic aliases. User-facing aliases never overwrite evidence. */
export function normalizeLocationQuery(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  const alias = LOCATION_ALIASES.find((candidate) => normalized.includes(candidate.alias.toLocaleLowerCase()) || normalized === candidate.canonical.toLocaleLowerCase());
  return alias?.canonical ?? value.trim();
}

export function normalizeItineraryQuery(query: ItineraryQuery): ItineraryQuery {
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
  return normalizeLocationQuery(value).toLocaleLowerCase().includes(queryLocation.toLocaleLowerCase());
}
