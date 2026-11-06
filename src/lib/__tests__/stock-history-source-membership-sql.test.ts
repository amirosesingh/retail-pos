import {createRequire} from 'node:module';
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url),{createStockSourceAdmissionCloud}=require('../../../scripts/lib/stock-source-admission-fixture.cjs');
let f:Awaited<ReturnType<typeof createStockSourceAdmissionCloud>>;
beforeAll(async()=>{f=await createStockSourceAdmissionCloud();},30000);
afterAll(async()=>f?.db.close());
beforeEach(async()=>{
 await f.db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.role','service_role',false);
 TRUNCATE private.stock_history_source_claim_verifications,private.stock_history_claim_receipts,private.stock_history_effect_coverage,
 public.stock_history_movements,private.stock_history_original_sources,private.stock_history_effect_sources,private.stock_history_source_receipts,
 private.stock_history_accepted_effects,private.stock_history_capture_gaps,stock_history_heads,stock_delta_applied,item_activity_logs,stock_adjustments,purchase_orders,sync_idempotency_receipts;
 UPDATE app_users SET is_active=true,store_id='a',permissions='{"can_adjust_stock":true,"can_receive_purchase_order":true}';UPDATE pos_sync_private.shift_author_keys SET revoked_at=NULL;
 UPDATE products SET stock_by_store='{"a":3,"b":2}';`);
});
describe('verified original membership needs its actual immutable accepted source and effect',()=>{
 it.each(['ADJUST','RECEIVE'])('admits %s only after actual same-transaction accepted business evidence without another stock write',async action=>{
  const op=await f.operation({action,quantity:action==='ADJUST'?'-1':'2'});
  expect(await op.upload()).toMatchObject({ok:true,stockSourceStatus:'captured_unverified'});
  expect(await f.scalar("SELECT stock_by_store->>'a' FROM products")).toBe(op.after);
  const accepted=await op.accept();expect(accepted).toMatchObject({ok:true,receipts:[{id:op.row.id}]});
  expect(await f.scalar("SELECT stock_by_store->>'a' FROM products")).toBe(op.after);
  expect(await f.scalar('SELECT count(*)::int FROM private.stock_history_source_claim_verifications')).toBe(1);
  expect(await f.scalar('SELECT time_grade FROM private.stock_history_source_claim_verifications')).toBe('author_claimed');
  expect(await f.scalar('SELECT clock_state FROM stock_history_movements')).toBe('unverified');
  expect(await f.scalar('SELECT coverage_state FROM stock_history_heads')).toBe('incomplete');
  expect(await op.upload()).toMatchObject({ok:true,replayed:true});expect(await op.accept()).toEqual(accepted);
 });
 it('does not turn a valid original signature/membership into an unaccepted stock source',async()=>{
  const op=await f.operation();await expect(op.accept()).rejects.toThrow('STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN');
  expect(await f.scalar('SELECT count(*)::int FROM stock_history_movements')).toBe(0);expect(await f.scalar("SELECT stock_by_store->>'a' FROM products")).toBe('3');
 });
 it.each(['unverified','different-batch','different-member','different-manifest','different-cohort','wrong-timegrade'])('holds %s evidence after business acceptance, preserving stock and all originals',async mode=>{
  const op=await f.operation();await op.upload();const row=JSON.parse(JSON.stringify(op.submission));
  if(mode==='unverified')row.sourceState.verified=false;
  if(mode==='different-batch'){row.sourceState.sourceBatchId=f.product;const envelope=JSON.parse(row.sourceCohortJson);envelope.sourceBatchId=f.product;row.sourceCohortJson=JSON.stringify(envelope);}
  if(mode==='different-member')row.sourceState.memberIndex=1;
  if(mode==='different-manifest')row.sourceState.manifestJson=row.sourceState.manifestJson.replace('"-1"','"-2"');
  if(mode==='different-cohort'){const envelope=JSON.parse(row.sourceCohortJson);envelope.proofJson=envelope.proofJson.replace(op.header.sourceRoot,'b'.repeat(64));row.sourceCohortJson=JSON.stringify(envelope);}
  if(mode==='wrong-timegrade')row.sourceState.timeGrade='verified';
  await expect(op.accept([row])).rejects.toThrow('STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN');
  expect(await f.scalar('SELECT count(*)::int FROM stock_history_movements')).toBe(0);expect(await f.scalar('SELECT count(*)::int FROM private.stock_history_original_sources')).toBe(1);
  expect(await f.scalar("SELECT stock_by_store->>'a' FROM products")).toBe('2');
 });
 it('requires the original action permission for a new movement while retaining exact accepted history after revocation',async()=>{
  const op=await f.operation();await op.upload();await f.db.exec("UPDATE app_users SET permissions='{}';");
  await expect(op.accept()).rejects.toThrow('STOCK_HISTORY_AUTHOR_PERMISSION_REVOKED');
  await f.db.exec("UPDATE app_users SET permissions='{\"can_adjust_stock\":true}';");const ack=await op.accept();
  await f.db.exec('UPDATE app_users SET is_active=false;UPDATE pos_sync_private.shift_author_keys SET revoked_at=now();');
  op.submission.authorState.allowed=false;expect(await op.accept()).toEqual(ack);
 });
 it('uses immutable original accepted operation/effect records after later mutable source rows change',async()=>{
  const op=await f.operation();await op.upload();await f.db.exec("UPDATE stock_adjustments SET delta=-9;UPDATE item_activity_logs SET quantity_delta=-9;UPDATE products SET stock_by_store='{\"a\":12,\"b\":2}';");
  expect(await op.accept()).toMatchObject({ok:true});expect(await f.scalar("SELECT stock_by_store->>'a' FROM products")).toBe('12');
  expect(await f.scalar('SELECT quantity_delta::text FROM stock_history_movements')).toBe('-1');
 });
 it('rejects a submitted source row that the original writer ignored instead of accepting it as an actual saved document',async()=>{
  const op=await f.operation(),document=op.source.document.id;
  await f.db.query('INSERT INTO stock_adjustments VALUES($1,$2,$3,-9,3,-6)',[document,f.product,'a']);
  await op.upload();await expect(op.accept()).rejects.toThrow('STOCK_HISTORY_SOURCE_ORIGIN_UNPROVEN');
  expect(await f.scalar("SELECT stock_by_store->>'a' FROM products")).toBe('2');expect(await f.scalar('SELECT count(*)::int FROM stock_history_movements')).toBe(0);
  expect(await f.scalar("SELECT accepted_sources->'stock_adjustments'->0->>'delta' FROM private.stock_history_original_sources")).toBe('-9');
 });
 it('does not substitute a different original envelope on an already accepted movement retry',async()=>{
  const op=await f.operation();await op.upload();await op.accept();op.submission.sourceCohortJson+=' ';
  await expect(op.accept()).rejects.toThrow('STOCK_HISTORY_REPLAY_CONFLICT');expect(await f.scalar('SELECT count(*)::int FROM stock_history_movements')).toBe(1);
 });
});
