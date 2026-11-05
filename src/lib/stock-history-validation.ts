import {z} from 'zod';
import {canonicalStockInstant,stockInstant} from './stock-as-of';
import type {StockHistoryPage} from './stock-history-report';
const exactInstant=z.string().min(20).max(40).transform(value=>canonicalStockInstant(value));
export const stockHistoryRequestSchema=z.object({
 cutoff:exactInstant,timeZone:z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value}).format(0);return true;}catch{return false;}},'Choose a valid time zone.'),
 branchId:z.string().min(1).max(128).optional(),after:z.string().uuid().nullable().optional(),
 sourceRevision:z.string().min(1).max(512).nullable().optional(),limit:z.number().int().min(1).max(500).optional(),
 export:z.boolean().optional(),closedShiftId:z.string().uuid().optional(),
}).strict();
const units=z.string().regex(/^-?(?:0|[1-9]\d{0,37})$/);
const responseSchema=z.object({
 status:z.enum(['unavailable','unsupported','incomplete','complete']),reasons:z.array(z.string().min(1).max(80)).max(20),
 cutoff:exactInstant,timeZone:z.string().min(1).max(100),branchId:z.string().min(1).max(128),
 baselineAt:exactInstant.nullable().optional(),readAt:exactInstant.optional(),coverageThroughTicks:z.string().regex(/^-?\d{1,20}$/).nullable().optional(),
 sourceRevision:z.string().min(1).max(512).nullable().optional(),pendingCount:z.string().regex(/^\d{1,20}$/).optional(),restatable:z.literal(true).optional(),
 rows:z.array(z.object({productId:z.string().uuid(),locationId:z.string().min(1).max(128),name:z.string().max(200000),sku:z.string().max(20000).nullable(),
  barcode:z.string().max(20000).nullable(),quantity:units.nullable(),negative:z.boolean().nullable()})).max(500),next:z.string().uuid().nullable(),
});
export function checkedStockHistoryPage(input:unknown,branchId?:string):StockHistoryPage{
 if(new TextEncoder().encode(JSON.stringify(input)).byteLength>262144)throw new Error('The stock report page exceeds its safe response limit.');
 const page=responseSchema.parse(input),ids=new Set<string>();
 if(branchId&&page.branchId!==branchId)throw new Error('The stock report belongs to a different branch.');
 for(const row of page.rows){
  if(row.locationId!==page.branchId||ids.has(row.productId.toLowerCase())||
    (row.quantity===null?row.negative!==null:row.negative!==(BigInt(row.quantity)<0n)))throw new Error('The stock report returned inconsistent quantities or scope.');
  ids.add(row.productId.toLowerCase());
 }
 if(page.next&&(!page.rows.length||page.next.toLowerCase()!==page.rows.at(-1)!.productId.toLowerCase()))throw new Error('The stock report cursor could not be verified.');
 if(page.status==='complete'&&(!page.baselineAt||!page.readAt||!page.sourceRevision||page.reasons.length||page.pendingCount!=='0'||page.rows.some(row=>row.quantity===null)||
  stockInstant(page.baselineAt)>stockInstant(page.cutoff)||stockInstant(page.cutoff)>stockInstant(page.readAt)))throw new Error('The report did not prove complete historical coverage.');
 return page;
}
