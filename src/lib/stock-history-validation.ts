import {z} from 'zod';
import {canonicalStockInstant,stockInstant} from './stock-as-of';
import type {StockHistoryPage} from './stock-history-report';
const exactInstant=z.string().min(20).max(40).transform(value=>canonicalStockInstant(value));
export const stockHistoryRequestSchema=z.object({
 cutoff:exactInstant,timeZone:z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value}).format(0);return true;}catch{return false;}},'Choose a valid time zone.'),
 branchId:z.string().min(1).max(128).optional(),after:z.string().uuid().nullable().optional(),
 sourceRevision:z.string().min(1).max(512).nullable().optional(),limit:z.number().int().min(1).max(500).optional(),
 export:z.boolean().optional(),closedShiftId:z.string().uuid().optional(),periodStart:exactInstant.optional(),
}).strict();
const units=z.string().regex(/^-?(?:0|[1-9]\d{0,37})$/);
const responseSchema=z.object({
 status:z.enum(['unavailable','unsupported','incomplete','complete']),reasons:z.array(z.string().min(1).max(80)).max(20),
 cutoff:exactInstant,timeZone:z.string().min(1).max(100),branchId:z.string().min(1).max(128),
 baselineAt:exactInstant.nullable().optional(),readAt:exactInstant.optional(),coverageThroughTicks:z.string().regex(/^-?\d{1,20}$/).nullable().optional(),
 sourceRevision:z.string().min(1).max(512).nullable().optional(),pendingCount:z.string().regex(/^\d{1,20}$/).optional(),restatable:z.literal(true).optional(),
 period:z.object({start:exactInstant,endExclusive:exactInstant,through:exactInstant,fullDay:z.boolean()}).optional(),
 coverage:z.object({acceptedLedger:z.enum(['complete','incomplete']),writers:z.enum(['confirmed','pending','unknown']),
  balanceGrade:z.enum(['verified','recorded_provisional']),timeGrade:z.enum(['recorded','author_entered','mixed'])}).strict().optional(),
 rows:z.array(z.object({productId:z.string().uuid(),locationId:z.string().min(1).max(128),name:z.string().max(200000),sku:z.string().max(20000).nullable(),
  barcode:z.string().max(20000).nullable(),quantity:units.nullable(),negative:z.boolean().nullable(),
  openingQuantity:units.nullable().optional(),inQuantity:z.string().regex(/^(?:0|[1-9]\d{0,37})$/).nullable().optional(),
  outQuantity:z.string().regex(/^(?:0|[1-9]\d{0,37})$/).nullable().optional()})).max(500),next:z.string().uuid().nullable(),
});
export function checkedStockHistoryPage(input:unknown,branchId?:string):StockHistoryPage{
 if(new TextEncoder().encode(JSON.stringify(input)).byteLength>262144)throw new Error('The stock report page exceeds its safe response limit.');
 const page=responseSchema.parse(input),ids=new Set<string>();
 if(branchId&&page.branchId!==branchId)throw new Error('The stock report belongs to a different branch.');
 for(const row of page.rows){
  if(row.locationId!==page.branchId||ids.has(row.productId.toLowerCase())||
    (row.quantity===null?row.negative!==null:row.negative!==(BigInt(row.quantity)<0n)))throw new Error('The stock report returned inconsistent quantities or scope.');
  ids.add(row.productId.toLowerCase());
  const terms=[row.openingQuantity,row.inQuantity,row.outQuantity];
  if(page.period){
   if(terms.some(value=>value===undefined)||(row.quantity===null?terms.some(value=>value!==null):terms.some(value=>value===null)||BigInt(row.openingQuantity!)+BigInt(row.inQuantity!)-BigInt(row.outQuantity!)!==BigInt(row.quantity)))
    throw new Error('The inventory movements do not reconcile to stock available at the selected time.');
  }else if(terms.some(value=>value!==undefined))throw new Error('The inventory movement period could not be verified.');
 }
 if(page.period&&(page.period.through!==page.cutoff||stockInstant(page.period.start)>stockInstant(page.cutoff)||stockInstant(page.cutoff)>=stockInstant(page.period.endExclusive)||
  page.period.fullDay!==(stockInstant(page.cutoff)===stockInstant(page.period.endExclusive)-1n)))throw new Error('The stock report period changed unexpectedly.');
 if(page.next&&(!page.rows.length||page.next.toLowerCase()!==page.rows.at(-1)!.productId.toLowerCase()))throw new Error('The stock report cursor could not be verified.');
 if(page.coverage){
  const provisional=page.coverage.acceptedLedger==='complete'&&page.coverage.balanceGrade==='recorded_provisional'&&page.coverage.writers!=='confirmed';
  if(page.coverage.balanceGrade==='recorded_provisional'&&!provisional||page.status==='complete'&&
    (page.coverage.acceptedLedger!=='complete'||page.coverage.writers!=='confirmed'||page.coverage.balanceGrade!=='verified'))
   throw new Error('The accepted ledger and writer coverage grades do not agree.');
  if(provisional&&(!page.baselineAt||!page.readAt||!page.sourceRevision||page.status!=='incomplete'||
    !page.reasons.some(reason=>['WRITER_COVERAGE_PENDING','WRITER_COVERAGE_UNKNOWN'].includes(reason))||page.rows.some(row=>row.quantity===null)||
    stockInstant(page.baselineAt)>stockInstant(page.cutoff)||stockInstant(page.cutoff)>stockInstant(page.readAt)))
   throw new Error('The recorded stock snapshot is not fully bound to its accepted ledger.');
  if(page.status!=='complete'&&page.rows.some(row=>row.quantity!==null)&&(!provisional||page.status!=='incomplete'||
    page.reasons.some(reason=>!['WRITER_COVERAGE_PENDING','WRITER_COVERAGE_UNKNOWN','CLOCK_UNVERIFIED'].includes(reason))))
   throw new Error('Unproven historical quantities cannot be displayed as recorded stock.');
 }else if(page.status!=='complete'&&page.rows.some(row=>row.quantity!==null))throw new Error('Recorded stock requires explicit accepted-ledger coverage.');
 if(page.status==='complete'&&(!page.baselineAt||!page.readAt||!page.sourceRevision||page.reasons.length||page.pendingCount!=='0'||page.rows.some(row=>row.quantity===null)||
  stockInstant(page.baselineAt)>stockInstant(page.cutoff)||stockInstant(page.cutoff)>stockInstant(page.readAt)))throw new Error('The report did not prove complete historical coverage.');
 return page;
}
