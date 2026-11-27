'use strict';
const { canonicalInstant, fail, instant } = require('./stock-history-contract.cjs');
const { STOCK_MOVEMENT_MAX_CALENDAR_DAYS, stockReportDay } = require('../shared/stock-report-day.mjs');

// Native/desktop validation only. Hosted calendar admission belongs to the
// PostgreSQL reader, not an Intl transition scan in a Worker request.
function stockHistoryPeriod(periodStart, cutoff, zone) {
 if (periodStart === undefined) return null;
 const start = canonicalInstant(periodStart);
 const cutoffTicks = instant(cutoff);
 if (cutoffTicks < instant(start)) fail('ESTOCK_HISTORY_PERIOD_INVALID');

 const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
 });
 const dateOf = value => {
  const parts = formatter.formatToParts(new Date(value));
  const part = name => parts.find(entry => entry.type === name).value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
 };
 const firstDate = dateOf(start), finalDate = dateOf(cutoff);
 const daysApart = (Date.parse(finalDate) - Date.parse(firstDate)) / 86_400_000;
 if (daysApart < 0 || daysApart >= STOCK_MOVEMENT_MAX_CALENDAR_DAYS) fail('ESTOCK_HISTORY_PERIOD_INVALID');
 const firstDay = stockReportDay(firstDate, zone);
 const lastDay = daysApart === 0 ? firstDay : stockReportDay(finalDate, zone);
 const finalBoundary = instant(lastDay.endExclusive);
 if (firstDay.start !== start || cutoffTicks < instant(lastDay.start) || cutoffTicks >= finalBoundary)
  fail('ESTOCK_HISTORY_PERIOD_INVALID');
 return Object.freeze({ start, endExclusive: lastDay.endExclusive, through: cutoff, fullDay: cutoffTicks === finalBoundary - 1n });
}

module.exports = { stockHistoryPeriod };
