import { canonicalStockInstant, stockInstant } from "./stock-as-of";

const formatter = (timeZone: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
  minute: "2-digit", second: "2-digit", hourCycle: "h23", numberingSystem: "latn",
});
function wall(date: Date, format: Intl.DateTimeFormat): string {
  const parts = format.formatToParts(date);
  const value = (name: string) => parts.find(part => part.type === name)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}`;
}
export function stockDateTimeInput(instant: string | Date, timeZone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error("Choose a valid date and time.");
  return wall(date, formatter(timeZone));
}
export type StockTimeChoice = { instant: string; label: string };
/** Resolve a business-zone wall clock explicitly; a repeated DST hour has two choices. */
export function stockTimeChoices(value: string, timeZone: string): StockTimeChoice[] {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?$/.exec(value);
  if (!match) throw new Error("Enter a valid date and time.");
  const prefix = `${match[1]}:${match[2] ?? "00"}`, milliseconds = Date.parse(`${prefix}.000Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== `${prefix}.000Z`) throw new Error("Enter a valid date and time.");
  const format = formatter(timeZone), offsets = new Set<number>();
  // Discover the offsets on either side of a transition instead of choosing an
  // arbitrary occurrence of a repeated hour. This runs only on report submission.
  for (let hour = -36; hour <= 36; hour++) {
    const sample = milliseconds + hour * 3_600_000;
    offsets.add(Date.parse(`${wall(new Date(sample), format)}.000Z`) - sample);
  }
  const fraction = BigInt((match[3] ?? "").padEnd(7, "0"));
  const choices = new Map<string, StockTimeChoice>();
  for (const offset of offsets) {
    const candidate = milliseconds - offset;
    if (wall(new Date(candidate), format) !== prefix) continue;
    const ticks = BigInt(candidate) * 10_000n + fraction;
    const whole = new Date(candidate).toISOString().slice(0, 19);
    const instant = canonicalStockInstant(`${whole}.${String(fraction).padStart(7, "0")}Z`);
    if (stockInstant(instant) !== ticks) throw new Error("The selected time could not be resolved exactly.");
    const sign = offset < 0 ? "−" : "+", seconds = Math.abs(offset) / 1000;
    const label = `UTC${sign}${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")}${seconds % 60 ? `:${String(seconds % 60).padStart(2, "0")}` : ""}`;
    choices.set(instant, { instant, label });
  }
  return [...choices.values()].sort((a, b) => stockInstant(a.instant) < stockInstant(b.instant) ? -1 : 1);
}
