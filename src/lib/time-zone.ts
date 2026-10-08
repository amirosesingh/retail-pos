/**
 * Region-based clock.
 *
 * Terminals are often set up with a wrong or drifting PC clock. When an admin
 * picks a region, every displayed and printed time is rendered in that zone
 * instead of the machine's own. Stored values stay absolute ISO timestamps.
 */
let zone = "";
let dateOrder: "dmy" | "mdy" | "ymd" = "dmy";
let hour12 = false;
let personalLanguage = "en";
export function setPersonalLanguage(language: string) {
  personalLanguage = ["en", "ms", "zh-Hans", "ta", "hi"].includes(language) ? language : "en";
}

/** Common regions offered in settings; "" means "use this computer". */
export const TIME_ZONES = [
  "UTC",
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Manila",
  "Asia/Hong_Kong",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Istanbul",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
];

/** Called whenever settings load or change. */
export function setPosTimeZone(next: string | undefined) {
  zone = (next ?? "").trim();
}

/** Date order and clock chosen in Region & time settings. */
export function setPosFormats(date: string | undefined, time: string | undefined) {
  dateOrder = date === "mdy" || date === "ymd" ? date : "dmy";
  hour12 = time === "12h";
}

/** The locale that renders the chosen date order without inventing one. */
const localeForOrder = () =>
  personalLanguage !== "en" ? personalLanguage : dateOrder === "mdy" ? "en-US" : dateOrder === "ymd" ? "en-CA" : "en-GB";

export function posTimeZone(): string {
  return zone;
}

/** The zone actually in force, resolved for display. */
export function effectiveTimeZone(): string {
  return zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const opts = (extra: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({
  hour12,
  ...extra,
  ...(zone ? { timeZone: zone } : {}),
});

const asDate = (value: string | number | Date) =>
  value instanceof Date ? value : new Date(value);

export function formatDateTime(value: string | number | Date, extra: Intl.DateTimeFormatOptions = {}) {
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(localeForOrder(), opts(extra));
}

export function formatTime(value: string | number | Date, extra: Intl.DateTimeFormatOptions = {}) {
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(localeForOrder(), opts(extra));
}

export function formatDate(value: string | number | Date, extra: Intl.DateTimeFormatOptions = {}) {
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(localeForOrder(), opts(extra));
}

/** Stable YYYY-MM-DD key in the configured trading zone. */
export function posDayKey(value: string | number | Date = new Date()): string {
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(zone ? { timeZone: zone } : {}),
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Trading-zone hour for bucketing live dashboard activity. */
export function posHour(value: string | number | Date): number {
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return 0;
  const hour = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    ...(zone ? { timeZone: zone } : {}),
  })
    .formatToParts(d)
    .find((entry) => entry.type === "hour")?.value;
  return Math.min(23, Math.max(0, Number(hour) || 0));
}
