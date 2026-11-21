'use strict';
const c=require('./stock-history-contract.cjs');
// Native/desktop validation only. Hosted calendar admission belongs to the
// PostgreSQL reader, not an Intl transition scan in a Worker request.
function stockHistoryPeriod(periodStart,cutoff,zone){
 if(periodStart===undefined)return null;
 const start=c.canonicalInstant(periodStart),format=new Intl.DateTimeFormat('en-GB',{timeZone:zone,calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit'});
 const parts=format.formatToParts(new Date(start)),part=name=>parts.find(value=>value.type===name)?.value;
 const day=require('../shared/stock-report-day.mjs');
 // Path is relative to electron/db, so use the existing shared representation.
 const range=day.stockReportDay(`${String(part('year')).padStart(4,'0')}-${part('month')}-${part('day')}`,zone);
 if(range.start!==start||c.instant(cutoff)<c.instant(start)||c.instant(cutoff)>=c.instant(range.endExclusive))c.fail('ESTOCK_HISTORY_PERIOD_INVALID');
 return Object.freeze({start,endExclusive:range.endExclusive,through:cutoff,fullDay:c.instant(cutoff)===c.instant(range.endExclusive)-1n});
}
module.exports={stockHistoryPeriod};
