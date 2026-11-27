import{describe,it,expect}from'vitest';
import{checkedStockHistoryPage}from'../stock-history-validation';
import{stockHistoryForExport}from'../stock-history-export';
const page=()=>({status:'incomplete',reasons:['WRITER_COVERAGE_PENDING'],branchId:'a',cutoff:'2026-11-05T12:00:00.0000001Z',timeZone:'UTC',
 baselineAt:'2026-11-04T00:00:00.0000000Z',readAt:'2026-11-06T00:00:00.0000000Z',sourceRevision:'fixture-revision',pendingCount:'0',restatable:true,
 coverage:{acceptedLedger:'complete',writers:'pending',balanceGrade:'recorded_provisional',timeGrade:'author_entered'},
 rows:[{productId:'11111111-1111-4111-8111-111111111111',locationId:'a',name:'Fixture',sku:'0001',barcode:null,quantity:'9007199254740993',negative:false}],next:null});
describe('truthful accepted-ledger versus all-writer stock coverage',()=>{
 it('accepts explicit provisional recorded quantities without claiming overall completeness',()=>{expect(checkedStockHistoryPage(page(),'a')).toMatchObject({status:'incomplete',coverage:{writers:'pending'},rows:[{quantity:'9007199254740993'}]});});
 it.each(['CAPTURE_GAPS','MISSING_OPENING','UNVALIDATED_STOCK_EFFECTS','BASELINE_PREHISTORY_CHANGED'])('refuses numeric quantities with actual ledger gap %s',reason=>{const p=page();p.reasons.push(reason);expect(()=>checkedStockHistoryPage(p)).toThrow('Unproven');});
 it('refuses ungraded incomplete numbers and a false complete provisional page',()=>{const p=page();expect(()=>checkedStockHistoryPage({...p,coverage:undefined})).toThrow('explicit');expect(()=>checkedStockHistoryPage({...p,status:'complete',reasons:[]})).toThrow('grades');});
 it.each(['baselineAt','readAt','sourceRevision'])('refuses provisional numbers without exact %s binding',field=>{expect(()=>checkedStockHistoryPage({...page(),[field]:undefined})).toThrow('fully bound');});
 it('refuses incomplete accepted-ledger math even when pending writer text is plausible',()=>{const p=page();expect(()=>checkedStockHistoryPage({...p,coverage:{...p.coverage,acceptedLedger:'incomplete'}})).toThrow('grades');});
 it('keeps complete exports disabled for a valid provisional accepted-ledger page',async()=>{const p=checkedStockHistoryPage(page());await expect(stockHistoryForExport({branchId:'a',cutoff:p.cutoff,timeZone:'UTC'},async()=>p,()=>{})).rejects.toThrow();});
});
