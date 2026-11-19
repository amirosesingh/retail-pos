import {createRequire} from "node:module";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
const require=createRequire(import.meta.url);
const {createSaleItemScopeFixture}=require("../../../scripts/lib/sale-item-scope-fixture.cjs");
let fixture: Awaited<ReturnType<typeof createSaleItemScopeFixture>>;
beforeAll(async()=>{fixture=await createSaleItemScopeFixture();},30000);
afterAll(async()=>{await fixture?.db.close();});
const rows=(result: {rows: {id:string}[]})=>result.rows.map(row=>row.id);

describe("effective parent-scoped PostgreSQL sync contracts",()=>{
 it("reproduces global legacy leakage and missing bootstrap lines, then repairs only metadata/contracts",async()=>{
  const {db,uid}=fixture;
  await db.exec(`INSERT INTO sales(id,store_id) VALUES('${uid(1)}','A'),('${uid(2)}','B');
   INSERT INTO sale_items(id,sale_id,branch_id,row_version,created_at) VALUES('${uid(10)}','${uid(1)}',NULL,1,now()),('${uid(11)}','${uid(2)}',NULL,1,now());`);
  expect((await db.query("SELECT branch_id FROM sync_change_feed ORDER BY cursor")).rows).toEqual([{branch_id:'global'},{branch_id:'global'}]);
  expect((await db.query("SELECT row_count FROM pos_sync_counts_scoped('default','A','terminal',90) WHERE table_name='sale_items'")).rows).toEqual([{row_count:0}]);
  expect((await db.query("SELECT count(*) count FROM pos_sync_pull_history_v2('default','A','terminal',0,10) WHERE table_name='sale_items'")).rows[0].count).toBe(2);
  await fixture.apply();
  expect((await db.query("SELECT row_count FROM pos_sync_counts_scoped('default','A','terminal',90) WHERE table_name='sale_items'")).rows).toEqual([{row_count:1}]);
  const data=(await db.query("SELECT pos_sync_bootstrap_scoped('default','A','terminal','sale_items',NULL,90,10) value")).rows[0].value;
  expect(rows(data)).toEqual([uid(10)]);expect(data.rows[0].branch_id).toBeNull();
  expect((await db.query("SELECT row_data->>'id' id FROM pos_sync_pull_history_v2('default','A','terminal',0,10) WHERE table_name='sale_items'")).rows).toEqual([{id:uid(10)}]);
  expect((await db.query("SELECT branch_id,sale_parent_scope_verified FROM sync_change_feed ORDER BY cursor")).rows).toEqual([{branch_id:'global',sale_parent_scope_verified:false},{branch_id:'global',sale_parent_scope_verified:false}]);
 },30000);

 it("filters foreign pages before LIMIT so later owned lines cannot starve",async()=>{
  const {db,uid}=fixture;
  await db.exec('BEGIN');try{
   await db.exec(`DELETE FROM sync_change_feed;INSERT INTO sale_items(id,sale_id,branch_id,row_version,created_at)
    SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${uid(2)}',NULL,1,now() FROM generate_series(100,130)n;
    INSERT INTO sale_items(id,sale_id,branch_id,row_version,created_at)VALUES('${uid(20)}','${uid(1)}',NULL,1,now());`);
   const result=await db.query("SELECT row_data->>'id' id FROM pos_sync_pull_history_v2('default','A','terminal',0,10) WHERE table_name='sale_items'");
   expect(result.rows).toEqual([{id:uid(20)}]);
  }finally{await db.exec('ROLLBACK');}
 });

 it("publishes direct and cascade deletes once, retains proof for older global upserts, and rolls back with the domain",async()=>{
  const {db,uid}=fixture;
  await db.exec('BEGIN');try{
   await db.exec(`DELETE FROM sale_items WHERE id='${uid(10)}';`);
   expect((await db.query("SELECT row_data,branch_id FROM sync_change_feed f LEFT JOIN LATERAL (SELECT NULL::jsonb row_data) x ON true WHERE table_name='sale_items' AND tombstone")).rows).toEqual([{row_data:null,branch_id:'A'}]);
   const page=await db.query("SELECT entity_id,tombstone FROM pos_sync_pull_history_v2('default','A','terminal',0,10) WHERE table_name='sale_items'");
   expect(page.rows).toHaveLength(1);expect(page.rows[0].tombstone).toBe(true);
   expect((await db.query("SELECT count(*) count FROM pos_sync_pull_history_v2('default','B','terminal',0,10) WHERE tombstone")).rows[0].count).toBe(0);
  }finally{await db.exec('ROLLBACK');}
  expect((await db.query(`SELECT count(*) count FROM sale_items WHERE id='${uid(10)}'`)).rows[0].count).toBe(1);
  await db.exec('BEGIN');try{
   await db.exec(`DELETE FROM sales WHERE id='${uid(1)}';`);
   expect((await db.query("SELECT count(*) count FROM sync_change_feed WHERE table_name='sale_items' AND tombstone AND branch_id='A' AND sale_parent_scope_verified")).rows[0].count).toBe(1);
   expect((await db.query("SELECT count(*) count FROM pos_sync_pull_history_v2('default','A','terminal',0,10) WHERE table_name='sale_items' AND tombstone")).rows[0].count).toBe(1);
  }finally{await db.exec('ROLLBACK');}
 });

 it("publishes verified insert and update metadata without relabelling nullable business fields",async()=>{
  const {db,uid}=fixture;
  await db.exec('BEGIN');try{
   await db.exec(`INSERT INTO sale_items(id,sale_id,branch_id,row_version,created_at)VALUES('${uid(21)}','${uid(1)}',NULL,1,now());
    UPDATE sale_items SET row_version=2 WHERE id='${uid(21)}';`);
   expect((await db.query(`SELECT branch_id,operation,row_version,sale_parent_scope_verified FROM sync_change_feed WHERE entity_id=jsonb_build_object('id','${uid(21)}'::uuid)::text ORDER BY cursor`)).rows).toEqual([
    {branch_id:'A',operation:'insert',row_version:1,sale_parent_scope_verified:true},
    {branch_id:'A',operation:'update',row_version:2,sale_parent_scope_verified:true},
   ]);
   await db.exec('SAVEPOINT invalid_label');
   await expect(db.exec(`UPDATE sale_items SET branch_id='B' WHERE id='${uid(21)}'`)).rejects.toThrow('SYNC_SALE_ITEM_SCOPE_MISMATCH');
   await db.exec('ROLLBACK TO SAVEPOINT invalid_label');
   expect((await db.query(`SELECT branch_id,row_version FROM sale_items WHERE id='${uid(21)}'`)).rows).toEqual([{branch_id:null,row_version:2}]);
   expect((await db.query(`SELECT count(*) count FROM sync_change_feed WHERE entity_id=jsonb_build_object('id','${uid(21)}'::uuid)::text`)).rows[0].count).toBe(2);
  }finally{await db.exec('ROLLBACK');}
 });

 it("holds unknown historical tombstones and explicit scope mismatches instead of inventing authority",async()=>{
  const {db,uid}=fixture;
  await db.exec('BEGIN');try{
   await db.exec(`INSERT INTO sync_change_feed(organization_id,branch_id,table_name,entity_id,operation,tombstone) VALUES('default','global','sale_items','{"id":"${uid(99)}"}','delete',true);`);
   await expect(db.query("SELECT * FROM pos_sync_pull_history_v2('default','A','terminal',0,10)")).rejects.toThrow('SYNC_SALE_ITEM_SCOPE_UNVERIFIED');
  }finally{await db.exec('ROLLBACK');}
  await db.exec('BEGIN');try{
   await db.exec(`ALTER TABLE sale_items DISABLE TRIGGER sync_feed_change;UPDATE sale_items SET branch_id='B' WHERE id='${uid(10)}';ALTER TABLE sale_items ENABLE TRIGGER sync_feed_change;`);
   await db.exec('SAVEPOINT scope_failure');
   await expect(db.query("SELECT * FROM pos_sync_counts_scoped('default','A','terminal',90)")).rejects.toThrow('SYNC_SALE_ITEM_SCOPE_MISMATCH');
   await db.exec('ROLLBACK TO SAVEPOINT scope_failure');
   await expect(db.query("SELECT * FROM pos_sync_pull_history_v2('default','A','terminal',0,10)")).rejects.toThrow('SYNC_SALE_ITEM_SCOPE_MISMATCH');
  }finally{await db.exec('ROLLBACK');}
 });

 it("holds eligible tombstones after same or foreign branch ID reuse",async()=>{
  const {db,uid}=fixture;
  for(const parent of[uid(1),uid(2)]){
   await db.exec('BEGIN');try{
    await db.exec(`DELETE FROM sale_items WHERE id='${uid(10)}';INSERT INTO sale_items(id,sale_id,branch_id,row_version,created_at)VALUES('${uid(10)}','${parent}',NULL,1,now());`);
    await expect(db.query("SELECT * FROM pos_sync_pull_history_v2('default','A','terminal',0,10)")).rejects.toThrow('SYNC_SALE_ITEM_TOMBSTONE_REVIEW');
   }finally{await db.exec('ROLLBACK');}
  }
  await db.exec('BEGIN');try{
   await db.exec(`INSERT INTO sync_change_feed(organization_id,branch_id,table_name,entity_id,operation,tombstone)VALUES('default','global','sale_items','{"id":"${uid(11)}"}','delete',true);`);
   await expect(db.query("SELECT * FROM pos_sync_pull_history_v2('default','A','terminal',0,10)")).rejects.toThrow('SYNC_SALE_ITEM_TOMBSTONE_REVIEW');
  }finally{await db.exec('ROLLBACK');}
 });

 it("refuses partial proof metadata, unsafe defaults, wrong proof indexes and a conditional delete trigger",async()=>{
  const {db}=fixture;
  const cases=[
   ["ALTER TABLE sync_change_feed ALTER COLUMN sale_parent_scope_verified SET DEFAULT true",'SALE_ITEM_SCOPE_FEED_SHAPE'],
   ["DROP INDEX sync_sale_item_scope_proof_v1;CREATE INDEX sync_sale_item_scope_proof_v1 ON sync_change_feed(cursor)",'SALE_ITEM_SCOPE_PROOF_INDEX_CHANGED'],
   ["DROP TRIGGER sync_sale_items_parent_delete_v1 ON sales;CREATE TRIGGER sync_sale_items_parent_delete_v1 BEFORE DELETE ON sales FOR EACH ROW WHEN(false) EXECUTE FUNCTION pos_sync_sale_items_parent_delete_v1()",'SALE_ITEM_SCOPE_DELETE_TRIGGER_CHANGED'],
   ["DROP TRIGGER sync_sale_items_parent_delete_v1 ON sales;DROP FUNCTION pos_sync_assert_sale_item_scope_v1(text);DROP FUNCTION pos_sync_sale_item_feed_visible_v1(uuid,text,boolean);DROP FUNCTION pos_sync_sale_items_parent_delete_v1()",'SALE_ITEM_SCOPE_PARTIAL_COMPONENT'],
  ];
  for(const[change,error]of cases){await db.exec('BEGIN');try{await db.exec(change);await expect(db.exec(fixture.sql)).rejects.toThrow(error);}finally{await db.exec('ROLLBACK');}}
 });

 it("replays exactly, updates immediate wrapper pins and denies untrusted helper access",async()=>{
  const {db}=fixture;
  await fixture.apply();
  for(const [wrapper,callee]of[
   ['pos_sync_feed_page_v2(text,text,text,bigint,boolean,integer)','pos_sync_pull_history_v2(text,text,text,bigint,integer)'],
   ['pos_sync_feed_page_v1(text,text,text,bigint,boolean,integer)','pos_sync_pull(text,text,text,bigint,integer)'],
   ['pos_sync_history_page_v1(text,text,text,text,integer,boolean,integer)','pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)'],
  ])expect((await db.query("SELECT strpos(pg_get_functiondef($1::regprocedure),md5(pg_get_functiondef($2::regprocedure))) position",['public.'+wrapper,'public.'+callee])).rows[0].position).toBeGreaterThan(0);
  expect((await db.query("SELECT has_function_privilege('authenticated','public.pos_sync_sale_item_feed_visible_v1(uuid,text,boolean)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
 });
});
