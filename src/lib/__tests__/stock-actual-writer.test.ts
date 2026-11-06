import{createRequire}from'node:module';
import{readFileSync}from'node:fs';
import{randomUUID}from'node:crypto';
import{beforeAll,beforeEach,afterAll,describe,it,expect}from'vitest';
const require=createRequire(import.meta.url),{createActualStockWriter,stockFunction}=require('../../../scripts/lib/stock-actual-writer-fixture.cjs');
describe.each([false,true])('actual stock source writers, captured current adjustment=%s',capturedAdjustment=>{
 let f:Awaited<ReturnType<typeof createActualStockWriter>>;
 beforeAll(async()=>{f=await createActualStockWriter({capturedAdjustment});},30000);
 afterAll(async()=>f?.db.close());
 beforeEach(async()=>{await f.db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.role','service_role',false);
  TRUNCATE private.stock_history_effect_coverage,private.stock_history_effect_sources,private.stock_history_accepted_effects,private.stock_history_source_receipts,private.stock_history_capture_gaps,
   stock_history_heads,stock_delta_applied,item_activity_logs,stock_adjustments,purchase_orders,purchase_order_items,sync_idempotency_receipts;
  UPDATE products SET stock_by_store='{"A":10}',stock_quantity=10,selling_price=0,row_version=1;
  SET CONSTRAINTS ALL IMMEDIATE;
  TRUNCATE private.stock_history_effect_coverage,private.stock_history_effect_sources,private.stock_history_accepted_effects,private.stock_history_capture_gaps;`);});
 it('applies the actual native count shape once; same batch, new batch and changed duplicate source cannot repeat its delta',async()=>{
  const movement=f.adjustment(),batch=randomUUID(),ops=[{table:'products',rows:[await f.productRow(7)]},{table:'stock_adjustments',rows:[movement]}];
  expect(await f.push(batch,ops)).toMatchObject({ok:true});expect(await f.stock()).toBe('7');
  expect(await f.scalar('SELECT count(*)::int FROM private.stock_history_accepted_effects')).toBe(1);
  expect(await f.push(batch,ops)).toMatchObject({ok:true});expect(await f.push(randomUUID(),ops)).toMatchObject({ok:true});expect(await f.stock()).toBe('7');
  expect(await f.push(randomUUID(),[{table:'stock_adjustments',rows:[{...movement,delta:-9,updated_stock:1}]}])).toMatchObject({ok:true});
  expect(await f.stock()).toBe('7');expect(await f.scalar('SELECT delta FROM stock_adjustments')).toBe(-3);
  expect(await f.scalar('SELECT count(*)::int FROM stock_delta_applied')).toBe(1);expect(await f.scalar('SELECT count(*)::int FROM private.stock_history_effect_sources')).toBe(1);
 });
 it('rolls back stock, document, product edits and business receipt for invalid new delta',async()=>{
  const movement=f.adjustment(),batch=randomUUID(),product={...await f.productRow(7),selling_price:999};
  await expect(f.push(batch,[{table:'products',rows:[product]},{table:'stock_adjustments',rows:[{...movement,delta:-1}]}])).rejects.toThrow('Invalid stock adjustment movement');
  expect(await f.stock()).toBe('10');expect(await f.scalar('SELECT selling_price::text FROM products')).toBe('0');
  for(const table of ['stock_adjustments','stock_delta_applied','sync_idempotency_receipts','private.stock_history_accepted_effects'])expect(await f.scalar('SELECT count(*)::int FROM '+table)).toBe(0);
 });
 it('keeps the existing branch/terminal scope gate and rejects a foreign adjustment before stock admission',async()=>{
  const movement={...f.adjustment(),store_id:'B'};
  await expect(f.push(randomUUID(),[{table:'stock_adjustments',rows:[movement]}])).rejects.toThrow();
  expect(await f.stock()).toBe('10');expect(await f.scalar('SELECT count(*)::int FROM stock_adjustments')).toBe(0);
  await expect(f.push(randomUUID(),[{table:'stock_adjustments',rows:[f.adjustment()]}],'B')).rejects.toThrow();expect(await f.stock()).toBe('10');
  expect(await f.scalar("SELECT has_function_privilege('anon','public.sync_apply_stock_adjustments(jsonb)','EXECUTE')")).toBe(false);
  expect(await f.scalar("SELECT has_function_privilege('authenticated','public.sync_apply_stock_adjustments(jsonb)','EXECUTE')")).toBe(false);
  expect(await f.scalar("SELECT has_function_privilege('service_role','public.sync_apply_stock_adjustments(jsonb)','EXECUTE')")).toBe(true);
 });
 it('actual receiving and native refund-stock legs produce unique real effects, without pretending full financial refund acceptance',async()=>{
  const invoice=randomUUID(),activity=randomUUID(),receive=[{table:'purchase_orders',rows:[{id:invoice,store_id:'A',status:'posted',po_number:'FIXTURE-GRN',total_cost:0,total_items_count:2,created_at:'2026-11-06T00:01:00Z',updated_at:'2026-11-06T00:01:00Z',row_version:1}]},
   {table:'item_activity_logs',rows:[{id:activity,product_id:f.product,store_id:'A',terminal_id:f.terminal,activity_type:'receive',reference:'FIXTURE-GRN',quantity_delta:2,unit_cost:0,note:'',created_at:'2026-11-06T00:01:00Z',row_version:1}]}];
  expect(await f.push(randomUUID(),receive)).toMatchObject({ok:true});expect(await f.stock()).toBe('12');expect(await f.push(randomUUID(),receive)).toMatchObject({ok:true});expect(await f.stock()).toBe('12');
  const refundId=randomUUID(),refund=[{table:'products',rows:[await f.productRow(13)]},{table:'stock_delta_applied',rows:[{movement_id:refundId,product_id:f.product,store_id:'A',delta:1,applied_at:'2026-11-06T00:02:00Z'}]}];
  expect(await f.push(randomUUID(),refund)).toMatchObject({ok:true});expect(await f.stock()).toBe('13');expect(await f.push(randomUUID(),refund)).toMatchObject({ok:true});expect(await f.stock()).toBe('13');
  expect(await f.scalar('SELECT count(*)::int FROM private.stock_history_accepted_effects')).toBe(2);expect(await f.scalar('SELECT count(*)::int FROM private.stock_history_effect_sources')).toBe(2);
 });
});
it('fresh canonical adjustment definition exactly matches the already-correct generator output',()=>{
 const source=readFileSync('scripts/generate-supabase-sync-contract.cjs','utf8').replaceAll('\r\n','\n'),start=source.indexOf('out.push(`CREATE OR REPLACE FUNCTION public.sync_apply_stock_adjustments(');
 expect(start).toBeGreaterThan(0);const body=source.slice(start+'out.push(`'.length,source.indexOf('`);',start));
 expect(stockFunction('sync_apply_stock_adjustments')).toBe(body);
});
