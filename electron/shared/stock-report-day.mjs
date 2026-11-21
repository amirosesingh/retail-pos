/** Calendar boundaries only: no clock, stock, authorization or coverage proof.
 * A single interval cannot represent a noncontiguous historical local date;
 * those dates and dates skipped by a time-zone change are rejected explicitly. */
const DAY = 86_400_000;
const HOUR = 3_600_000;

function invalid(code = 'STOCK_DAY_INVALID') {
  throw Object.assign(new Error('Choose a valid, representable business date and time zone.'), { code });
}

function calendarFormatter(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 100
    || timeZone !== timeZone.trim() || /^[+-]/.test(timeZone)) invalid();
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn', era: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
      minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch { invalid(); }
}

function offsetAt(milliseconds, format) {
  const parts = format.formatToParts(new Date(milliseconds));
  const part = name => parts.find(value => value.type === name)?.value;
  const year = Number(part('year')) * (part('era') === 'BC' ? -1 : 1)
    + (part('era') === 'BC' ? 1 : 0);
  const wall = new Date(0);
  wall.setUTCFullYear(year, Number(part('month')) - 1, Number(part('day')));
  wall.setUTCHours(Number(part('hour')), Number(part('minute')), Number(part('second')), 0);
  return wall.getTime() - milliseconds;
}

function instant(milliseconds) {
  const date = new Date(milliseconds);
  if (!Number.isFinite(milliseconds) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) invalid();
  return `${date.toISOString().slice(0, 19)}.0000000Z`;
}

/** Resolve the complete IANA calendar day, including 23/25-hour days, a skipped
 * midnight, or a contiguous repeated date. ICU/IANA transitions have whole-second
 * precision; the UTC scan brackets their offsets and resolves boundaries exactly.
 * No boundary is rounded to the viewing machine's calendar or to 24 hours. */
export function stockReportDay(date, timeZone) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) invalid();
  const naive = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(naive) || Number(date.slice(0, 4)) < 1
    || new Date(naive).toISOString() !== `${date}T00:00:00.000Z`) invalid();
  const next = naive + DAY;
  const format = calendarFormatter(timeZone);
  // All IANA UTC offsets, including historical date-line changes, fit inside
  // this bounded window. Adjacent offset segments are intersected with the
  // requested local date before joining; another local date is never included.
  const low = naive - 2 * DAY, high = next + 2 * DAY;
  const segments = [];
  let start = low, prior = low, offset = offsetAt(low, format);
  for (let sample = low + HOUR; sample <= high; sample += HOUR) {
    const sampledOffset = offsetAt(sample, format);
    if (sampledOffset !== offset) {
      let left = prior, right = sample;
      while (right - left > 1000) {
        const middle = left + Math.floor((right - left) / 2000) * 1000;
        if (offsetAt(middle, format) === offset) left = middle;
        else right = middle;
      }
      segments.push({ start, end: right, offset });
      start = right;
      offset = sampledOffset;
    }
    prior = sample;
  }
  segments.push({ start, end: high, offset });
  const ranges = [];
  for (const segment of segments) {
    const begin = Math.max(segment.start, naive - segment.offset);
    const end = Math.min(segment.end, next - segment.offset);
    if (begin >= end) continue;
    const previous = ranges.at(-1);
    if (previous && previous.end === begin) previous.end = end;
    else ranges.push({ start: begin, end });
  }
  if (!ranges.length) invalid('STOCK_DAY_SKIPPED');
  if (ranges.length !== 1) invalid('STOCK_DAY_NONCONTIGUOUS');
  return Object.freeze({ date, timeZone, start: instant(ranges[0].start), endExclusive: instant(ranges[0].end) });
}
