import type { ItineraryQuery } from "./domain.ts";

export interface LocationAlias { alias: string; canonical: string; }

/** Versioned, deterministic aliases. User-facing aliases never overwrite evidence. */
export const LOCATION_ALIASES: readonly LocationAlias[] = [
  { alias: "馬蹄灣", canonical: "Horseshoe Bend" },
  { alias: "羚羊谷", canonical: "Lower Antelope Canyon" },
  { alias: "下羚羊谷", canonical: "Lower Antelope Canyon" },
  { alias: "大峽谷", canonical: "Grand Canyon" },
];

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
