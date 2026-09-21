export function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function localDate(value: string, timezone: string): string | null {
  if (isDateOnly(value)) return value;
  // An offsetless timestamp is a wall-clock value. Keep its stated calendar
  // date deterministic while the Review Issue asks the owner to resolve DST
  // ambiguity instead of letting the host process timezone decide.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function formatLocalDateTime(value: string, timezone: string): string {
  if (isDateOnly(value)) return value;
  const offsetless = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (offsetless) {
    const year = Number(offsetless[1]); const month = Number(offsetless[2]); const day = Number(offsetless[3]);
    const hour = Number(offsetless[4]); const minute = Number(offsetless[5]); const second = Number(offsetless[6] ?? "0");
    const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
    const candidates: number[] = [];
    for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
      const instant = wallClock - offset * 60_000;
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
      const get = (type: string) => parts.find((part) => part.type === type)?.value;
      if (Number(get("year")) === year && Number(get("month")) === month && Number(get("day")) === day && Number(get("hour")) === hour && Number(get("minute")) === minute && Number(get("second")) === second) candidates.push(offset);
    }
    if (candidates.length !== 1) return `${value} (UTC offset unresolved)`;
    const offset = candidates[0]; const sign = offset >= 0 ? "+" : "-"; const absolute = Math.abs(offset);
    return `${value.replace("T", " ")} (UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")})`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const localEpoch = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")), Number(get("hour")), Number(get("minute")), Number(get("second")));
  const offsetMinutes = Math.round((localEpoch - date.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} (UTC${sign}${hours}:${minutes})`;
}
