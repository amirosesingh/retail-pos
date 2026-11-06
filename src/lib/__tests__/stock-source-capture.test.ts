import {createRequire} from 'node:module';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url),c=require('../../../electron/db/stock-history-contract.cjs');
const{sourceManifestForMovement}=require('../../../electron/db/stock-source-capture.cjs');
const operation='11111111-1111-4111-8111-111111111111',product='22222222-2222-4222-8222-222222222222',author='33333333-3333-4333-8333-333333333333',document='44444444-4444-4444-8444-444444444444';
function fixture(action='ADJUST'){
 const claim={table:action==='ADJUST'?'stock_adjustments':'item_activity_logs',id:document,productId:product,branchId:'a',delta:'-1'};
 const before=[{id:product,name:'Original',stock_by_store:{a:2}}],after=[{id:product,name:'Original',stock_by_store:{a:1}}];
 const row=c.changes(c.normalizeContext({operationId:operation,branchId:'a',terminalId:'t',actorId:author,kind:action==='RECEIVE'?'receiving':'stock'},'2026-11-06T00:00:00.0000001Z'),before,after,[claim])[0];
 return{action,row,operations:[{kind:'insert',table:claim.table,rows:[{id:document,product_id:product}]}],before,after,claims:[claim]};
}
describe('original stock source claims from actual transaction readbacks',()=>{
 it('builds adjustment provenance only for the original saved source row and exact product/branch/delta',async()=>{
  const f=fixture(),source=JSON.parse(await sourceManifestForMovement(f));
  expect(source).toMatchObject({action:'ADJUST',operationId:operation,authorId:author,document:{type:'stock_adjustments',id:document},delta:'-1',effectiveAt:'2026-11-06T00:00:00.0000001Z'});
 });
 it.each(['missing-operation','missing-readback','product','branch','delta','multiple-documents'])('holds unsupported adjustment %s rather than guessing a document',async mode=>{
  const f=fixture();if(mode==='missing-operation')f.operations=[];if(mode==='missing-readback')f.claims=[];
  if(mode==='product')f.claims[0]!.productId=author;if(mode==='branch')f.claims[0]!.branchId='b';if(mode==='delta')f.claims[0]!.delta='-2';
  if(mode==='multiple-documents')f.row.source_refs.push(['stock_adjustments',author,'0']);
  expect(await sourceManifestForMovement(f)).toBeNull();
 });
 it('a product creation claim cannot relabel an existing product update as a new opening',async()=>{
  const f=fixture();f.action='PRODUCT_CREATE';f.operations=[{kind:'insert',table:'products',rows:[{id:product,product_id:product}]}];
  expect(await sourceManifestForMovement(f)).toBeNull();f.before=[];
  expect(JSON.parse(await sourceManifestForMovement(f)).document).toEqual({type:'products',id:product});
 });
 it('uses the actual receiving document and activity readbacks, never invoice time or a nonexistent table',async()=>{
  const f=fixture('RECEIVE'),queries:string[]=[];
  f.operations.push({kind:'upsert',table:'purchase_orders',rows:[{id:author,product_id:product}]});
  const responses=[[{id:author,store_id:'a',status:'posted',reference:'INV-1',po_number:'INV-1'}],[{id:document,product_id:product,store_id:'a',activity_type:'receive',reference:'INV-1',delta:'-1'}]];
  const request=()=>({input:vi.fn().mockReturnThis(),query:vi.fn(async(sql:string)=>{queries.push(sql);return{recordset:responses.shift()};})});
  const source=JSON.parse(await sourceManifestForMovement({...f,request}));expect(source.document).toEqual({type:'receivings',id:author});
  expect(queries[0]).toContain('dbo.purchase_orders');expect(queries[0]).not.toContain('FROM dbo.receivings');expect(source.effectiveAt).toBe(f.row.effective_at_raw);
 });
 it.each(['draft','foreign-branch','wrong-reference','wrong-type','missing-product','missing-activity','ambiguous-document'])('retains receiving %s for review',async mode=>{
  const f=fixture('RECEIVE');f.operations.push({kind:'upsert',table:'purchase_orders',rows:[{id:author,product_id:product}]});
  if(mode==='ambiguous-document')f.operations.push({kind:'upsert',table:'purchase_orders',rows:[{id:product,product_id:product}]});
  const header={id:author,store_id:mode==='foreign-branch'?'b':'a',status:mode==='draft'?'draft':'posted',reference:'INV-1',po_number:'INV-1'};
  const activity={id:document,product_id:mode==='missing-product'?author:product,store_id:'a',activity_type:mode==='wrong-type'?'sale':'receive',reference:mode==='wrong-reference'?'INV-2':'INV-1',delta:'-1'};
  let call=0;const request=()=>({input:vi.fn().mockReturnThis(),query:vi.fn(async()=>({recordset:call++===0?[header]:mode==='missing-activity'?[]:[activity]}))});
  expect(await sourceManifestForMovement({...f,request})).toBeNull();
 });
 it.each(['SALE','REFUND','TRANSFER_DISPATCH','TRANSFER_RECEIVE','PRODUCT_MERGE','SPONSORSHIP_ISSUE','MISSED_BILL','GENERAL'])('does not infer unsupported %s origin from unrelated present-day rows',async action=>{
  const request=vi.fn();expect(await sourceManifestForMovement({...fixture(),action,request})).toBeNull();expect(request).not.toHaveBeenCalled();
 });
});
