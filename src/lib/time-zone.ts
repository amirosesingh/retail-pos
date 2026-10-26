/**
 * Region-based clock.
 *
 * Terminals are often set up with a wrong or drifting PC clock. When an admin
 * picks a region, every displayed and printed time is rendered in that zone
 * instead of the machine's own. Stored values stay absolute ISO timestamps.
 */
let zone = "";
let hour12 = false;
let personalLanguage = "en";
export function setPersonalLanguage(language: string) {
  personalLanguage = ["en", "ms", "zh-Hans", "ta", "hi"].includes(language) ? language : "en";
}

/** Common regions offered in settings; "" means "use this computer". */
export const TIME_ZONES = [
  "UTC",
  "Asia/Brunei",
  "Africa/Nairobi",
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
export function setPosFormats(_date: string | undefined, time: string | undefined) {
  // Keep the legacy date argument for callers; displayed dates use DD-MM-YYYY.
  hour12 = time === "12h";
}

/** The language used for clock labels. */
const localeForOrder = () =>
  personalLanguage !== "en" ? personalLanguage : "en-GB";

export function posTimeZone(): string {
  return zone;
}

/** The zone actually in force, resolved for display. */
export function effectiveTimeZone(): string {
  return zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const opts = (extra: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({
  hour12,
  ...(zone ? { timeZone: zone } : {}),
  ...extra,
});

const asDate = (value: string | number | Date) =>
  value instanceof Date ? value : new Date(value);

// Charts bucket thousands of records during a render. Reuse the expensive ICU
// formatter for explicit trading zones; keep the cache bounded across branches.
const bucketFormatters = new Map<string, Intl.DateTimeFormat>();
function bucketFormatter(kind: "day" | "hour", timeZone: string) {
  const key = `${kind}:${timeZone}`;
  let formatter = bucketFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", kind === "day"
      ? { year: "numeric", month: "2-digit", day: "2-digit", timeZone }
      : { hour: "2-digit", hourCycle: "h23", timeZone });
    if (bucketFormatters.size >= 32) bucketFormatters.delete(bucketFormatters.keys().next().value!);
    bucketFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatDateTime(value: string | number | Date, extra: Intl.DateTimeFormatOptions = {}) {
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  const { dateStyle: _dateStyle, timeStyle: _timeStyle, ...fields } = extra;
  return `${formatDate(d, fields)} ${formatTime(d, { hour: "2-digit", minute: "2-digit", second: "2-digit", ...fields })}`;
}

export function formatTime(value: string | number | Date, extra: Intl.DateTimeFormatOptions = {}) {
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(localeForOrder(), opts(extra));
}

export function formatDate(value: string | number | Date, extra: Intl.DateTimeFormatOptions = {}) {
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    ...opts({}), ...(extra.timeZone ? { timeZone: extra.timeZone } : {}), ...(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? { timeZone: "UTC" } : {}), calendar: "gregory", numberingSystem: "latn",
    day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(d);
  const part = (name: string) => parts.find(p => p.type === name)?.value ?? "";
  return `${part("day")}-${part("month")}-${part("year")}`;
}

/** Stable YYYY-MM-DD key in the configured trading zone. */
export function posDayKey(value: string | number | Date = new Date(), timeZone = zone): string {
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return "";
  // Native getters follow a changed operating-system zone immediately, without
  // keeping an old implicit zone captured in a cached formatter.
  if (!timeZone) return `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parts = bucketFormatter("day", timeZone).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Trading-zone hour for bucketing live dashboard activity. */
export function posHour(value: string | number | Date): number {
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return 0;
  if (!zone) return d.getHours();
  const hour = bucketFormatter("hour", zone)
    .formatToParts(d)
    .find((entry) => entry.type === "hour")?.value;
  return Math.min(23, Math.max(0, Number(hour) || 0));
}

/** Date-only report comparisons use the configured business day on every platform. */
export function inPosDayRange(value: string | number | Date, from: string, to: string, timeZone?: string): boolean {
  const day = posDayKey(value, timeZone);
  return !!day && (!from || day >= from) && (!to || day <= to);
}

/** Generous UTC scan boundary; callers still filter by the exact business day. */
export function reportScanStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) - 86_400_000;
}
export function reportScanEnd(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) + 2 * 86_400_000 - 1;
}
