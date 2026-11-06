import{describe,it,expect}from'vitest';
import{checkedStockHistoryPage,stockHistoryRequestSchema}from'../stock-history-validation';
import type{StockHistoryPage}from'../stock-history-report';
const id='11111111-1111-4111-8111-111111111111';
const fixture=():StockHistoryPage=>({status:'complete',reasons:[],cutoff:'2026-11-05T12:00:00.1234567Z',timeZone:'UTC',branchId:'a',baselineAt:'2026-11-04T00:00:00.0000000Z',
 readAt:'2026-11-06T00:00:00.0000000Z',sourceRevision:'same-snapshot',pendingCount:'0',period:{start:'2026-11-05T00:00:00.0000000Z',endExclusive:'2026-11-06T00:00:00.0000000Z',through:'2026-11-05T12:00:00.1234567Z',fullDay:false},
 rows:[{productId:id,locationId:'a',name:'Original',sku:'0001',barcode:'00001',openingQuantity:'9007199254740993',inQuantity:'2',outQuantity:'4',quantity:'9007199254740991',negative:false}],next:null});
describe('selected-time inventory explanation wire integrity',()=>{
 it('keeps cutoff inclusive and exact strings; requested period is not an alternate cutoff',()=>{
  const page=fixture();expect(checkedStockHistoryPage(page,'a')).toEqual(page);
  expect(stockHistoryRequestSchema.parse({cutoff:page.cutoff,timeZone:'UTC',periodStart:page.period!.start}).cutoff).toBe(page.cutoff);
 });
 it.each(['formula','negative-in','missing-term','period-missing','through','start','end','fullDay','wrongbranch'])('rejects unbound/tampered %s',mode=>{
  const page=fixture();if(mode==='formula')page.rows[0]!.inQuantity='3';if(mode==='negative-in')page.rows[0]!.inQuantity='-2';
  if(mode==='missing-term')delete page.rows[0]!.openingQuantity;if(mode==='period-missing')delete page.period;
  if(mode==='through')page.period!.through='2026-11-05T12:00:00.1234566Z';if(mode==='start')page.period!.start='2026-11-05T13:00:00.0000000Z';
  if(mode==='end')page.period!.endExclusive=page.cutoff;if(mode==='fullDay')page.period!.fullDay=true;if(mode==='wrongbranch')page.rows[0]!.locationId='b';
  expect(()=>checkedStockHistoryPage(page,'a')).toThrow();
 });
 it('preserves signed balance and distinguishes the last100ns of a calendar day',()=>{
  const page=fixture();Object.assign(page.rows[0]!,{openingQuantity:'-3',inQuantity:'1',outQuantity:'2',quantity:'-4',negative:true});
  page.cutoff='2026-11-05T23:59:59.9999999Z';page.period!.through=page.cutoff;page.period!.fullDay=true;
  expect(checkedStockHistoryPage(page,'a').rows[0]!.quantity).toBe('-4');
 });
 it('unknown evidence cannot be converted into apparent zero quantities',()=>{
  const page=fixture();page.status='incomplete';page.reasons=['MISSING_OPENING'];
  Object.assign(page.rows[0]!,{quantity:null,negative:null,openingQuantity:null,inQuantity:null,outQuantity:null});
  expect(checkedStockHistoryPage(page,'a').rows[0]!.quantity).toBeNull();page.rows[0]!.inQuantity='0';expect(()=>checkedStockHistoryPage(page,'a')).toThrow();
 });
});
