import type { TripItemKind } from "./domain.ts";

export const KIND_SYNONYMS: Readonly<Record<string, TripItemKind>> = {
  flight: "flight", 航班: "flight", lodging: "lodging", 住宿: "lodging", 飯店: "lodging", hotel: "lodging",
  rental_car: "rental_car", 租車: "rental_car", transport: "transport", 交通: "transport", meal: "meal", 餐: "meal",
  activity: "activity", 活動: "activity", shopping: "shopping", 購物: "shopping", 购物: "shopping", 逛街: "shopping", 買東西: "shopping", 买东西: "shopping",
  meeting: "meeting", 會議: "meeting", other: "other",
};

export function parseItineraryKind(value: string): TripItemKind | undefined {
  return KIND_SYNONYMS[value.trim().toLocaleLowerCase()];
}

export function parseItineraryKindMention(value: string): TripItemKind | undefined {
  const normalized = value.toLocaleLowerCase();
  return Object.entries(KIND_SYNONYMS).find(([alias]) => normalized.includes(alias.toLocaleLowerCase()))?.[1];
}
