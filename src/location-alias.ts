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
  return query.location ? { ...query, location: normalizeLocationQuery(query.location) } : query;
}
