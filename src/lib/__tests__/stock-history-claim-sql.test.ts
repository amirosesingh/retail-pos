import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { generateKeyPairSync, sign } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
const require=createRequire(import.meta.url),contract=require("../../../electron/db/stock-history-contract.cjs"),protocol=require("../../../electron/security/stock-event-author-protocol.cjs");
const base=readFileSync("supabase/migrations/20261105113916_stock_history_effective_ledger.sql","utf8"),capture=readFileSync("supabase/migrations/20261105172030_stock_history_accepted_effect_capture.sql","utf8"),admission=readFileSync("supabase/migrations/20261105232647_stock_history_author_claim_admission.sql","utf8");
const author="10000000-0000-4000-8000-000000000001",keyId="10000000-0000-4000-8000-000000000002",terminal="20000000-0000-4000-8000-000000000001",product="30000000-0000-4000-8000-000000000001",source="70000000-0000-4000-a000-300000000000",operation="50000000-0000-4000-8000-000000000001",other="60000000-0000-4000-8000-000000000001",sale="70000000-0000-4000-8000-000000000001",shift="80000000-0000-4000-8000-000000000001";
const pair=generateKeyPairSync("ed25519"),project="https://stock.fixture",at="2026-11-06T00:00:00.1234567Z";
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(current_setting('request.jwt.claim.role',true),'service_role')$$;
  CREATE TABLE app_users(id uuid PRIMARY KEY,user_id text,role text,role_slug text,store_id text,is_active boolean,permissions jsonb);
  CREATE TABLE terminal_tokens(id uuid PRIMARY KEY,location_id text,status text,revoked_at timestamptz,platform text,is_claimed boolean,claimed_at timestamptz,management_sync_enabled boolean);
  CREATE TABLE products(id uuid PRIMARY KEY,name text,sku text,barcode text,owner_store_id text,stock_by_store jsonb,stock_quantity integer,price numeric);
  CREATE TABLE stock_delta_applied(movement_id uuid PRIMARY KEY,product_id uuid,store_id text,delta integer);
  CREATE TABLE item_activity_logs(id uuid PRIMARY KEY,product_id uuid,store_id text,quantity_delta integer);
  CREATE TABLE shifts(id uuid PRIMARY KEY,store_id text,status text,closed_at timestamptz);CREATE TABLE stores(id text PRIMARY KEY);
  CREATE SCHEMA pos_sync_private;CREATE TABLE pos_sync_private.shift_author_keys(key_id uuid PRIMARY KEY,author_id uuid,terminal_id text,project_origin text,public_key text,subject text,revoked_at timestamptz);
  CREATE SCHEMA fin62_history_preparation;
  CREATE TABLE fin62_history_preparation.nodes(operation_id uuid PRIMARY KEY,organization_id text,branch_id text,terminal_id text,shift_id uuid,sequence bigint,node_kind text,payload_json text,proof jsonb);
  CREATE TABLE fin62_history_preparation.sale_steps(operation_id uuid,sale_id uuid,organization_id text,branch_id text,terminal_id text,shift_id uuid,sequence bigint,action text,before_fact jsonb,after_fact jsonb);
  CREATE TABLE fin62_history_preparation.sale_birth_claims(sale_id uuid,organization_id text,branch_id text,terminal_id text,shift_id uuid,operation_id uuid);
  CREATE TABLE fin62_history_preparation.business_receipts(batch_id uuid PRIMARY KEY,organization_id text,branch_id text,terminal_id text,operations jsonb,acknowledgement jsonb);
  CREATE TABLE fin62_history_preparation.publications(batch_id uuid,sale_id uuid,organization_id text,branch_id text,terminal_id text,shift_id uuid,financial_fact jsonb,stream_sequence bigint,capture_xid xid8);
  -- This suite composes the source predicates with the trusted financial-fact
  -- normalizer boundary. Real FIN62 writer/math acceptance is a separate gate.
  CREATE FUNCTION fin62_history_preparation.row_fact(v jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('id',v->>'id','totalAmount',v->>'total_amount')$$;
  CREATE FUNCTION pos_sync_validate_scope(text,text,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
   IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens WHERE id::text=$3 AND location_id=$2 AND revoked_at IS NULL) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';END IF;END$$;
  INSERT INTO stores VALUES('a'),('A'),('b');INSERT INTO app_users VALUES('${author}','cashier-a','staff','cashier','a',true,'{"can_process_sale":true}');
  INSERT INTO terminal_tokens VALUES('${terminal}','a','used',NULL,'pc',true,now(),false);
  INSERT INTO products VALUES('${product}','Fixture','0001','00001','a','{"a":3,"b":2}',5,19.95);`);
 await db.query("INSERT INTO pos_sync_private.shift_author_keys VALUES($1,$2,$3,$4,$5,'cashier-a',NULL)",[keyId,author,terminal,project,pair.publicKey.export({type:"spki",format:"der"}).toString("base64url")]);
 await db.exec(base);await db.exec(capture);await db.exec(admission);
},30000);
afterAll(async()=>db?.close());
beforeEach(async()=>{
 await db.exec(`RESET ROLE;SELECT set_config('request.jwt.claim.role','service_role',false);
  TRUNCATE private.stock_history_claim_receipts,private.stock_history_effect_coverage,public.stock_history_movements,private.stock_history_effect_sources,private.stock_history_source_receipts,private.stock_history_accepted_effects,private.stock_history_capture_gaps,stock_delta_applied,item_activity_logs,stock_history_heads;
  TRUNCATE fin62_history_preparation.nodes,fin62_history_preparation.sale_steps,fin62_history_preparation.sale_birth_claims,fin62_history_preparation.business_receipts,fin62_history_preparation.publications;
  UPDATE app_users SET role='staff',role_slug='cashier',store_id='a',is_active=true,permissions='{"can_process_sale":true}';UPDATE pos_sync_private.shift_author_keys SET revoked_at=NULL;
  UPDATE products SET stock_by_store='{"a":3,"b":2}' WHERE id='${product}';
  SET CONSTRAINTS ALL IMMEDIATE;
  TRUNCATE private.stock_history_effect_coverage,private.stock_history_effect_sources,private.stock_history_source_receipts,private.stock_history_accepted_effects,private.stock_history_capture_gaps;`);
});
async function effect(withOrigin=true){
 const body=[{table:'sales',rows:[{id:sale,bill_number:'FIXTURE',store_id:'a',total_amount:'10'}]},
  {table:'sale_items',rows:[{id:'70000000-0000-4000-a000-100000000000',sale_id:sale,product_id:product,quantity:1,is_return:false}]},
  {table:'item_activity_logs',rows:[{id:source,product_id:product,store_id:'a',quantity_delta:-1,reference:'FIXTURE',activity_type:'sale'}]}];
 await db.exec(`BEGIN;INSERT INTO stock_delta_applied VALUES('${source}','${product}','a',-1);UPDATE products SET stock_by_store='{"a":2,"b":2}' WHERE id='${product}';`);
 try{
  if(withOrigin){
   const fact={id:sale,totalAmount:'10'},proof={action:'SALE',authorId:author,projectOrigin:project,branchId:'a',terminalId:terminal,operationId:operation},event={action:'SALE',operationId:operation,changes:[{saleId:sale}]};
   await db.query(`INSERT INTO fin62_history_preparation.nodes VALUES($1,'default','a',$2,$3,1,'MUTATION',$4,$5::jsonb)`,[operation,terminal,shift,JSON.stringify(event),JSON.stringify(proof)]);
   await db.query(`INSERT INTO fin62_history_preparation.sale_steps VALUES($1,$2,'default','a',$3,$4,1,'SALE',NULL,$5::jsonb)`,[operation,sale,terminal,shift,JSON.stringify(fact)]);
   await db.query(`INSERT INTO fin62_history_preparation.sale_birth_claims VALUES($1,'default','a',$2,$3,$4)`,[sale,terminal,shift,operation]);
   await db.query(`INSERT INTO fin62_history_preparation.business_receipts VALUES($1,'default','a',$2,$3::jsonb,'{"ok":true}')`,[other,terminal,JSON.stringify(body)]);
   await db.query(`INSERT INTO fin62_history_preparation.publications VALUES($1,$2,'default','a',$3,$4,$5::jsonb,1,pg_current_xact_id())`,[other,sale,terminal,shift,JSON.stringify(fact)]);
  }
  await db.exec('COMMIT');
 }catch(error){await db.exec('ROLLBACK');throw error;}
}
function claim(op=operation){
 const row=contract.changes(contract.normalizeContext({operationId:op,branchId:"a",terminalId:terminal,actorId:author,kind:"sale"},at),[{id:product,name:"Fixture",stock_by_store:{a:3}}],[{id:product,name:"Fixture",stock_by_store:{a:2}}],[{table:"stock_delta_applied",id:source,productId:product,branchId:"a",delta:"-1"}])[0];
 const fields={version:1,algorithm:"Ed25519",keyId,projectOrigin:project,terminalId:terminal,authorId:author,subject:"cashier-a",branchId:"a",operationId:op,movementId:row.id,action:"SALE",payloadHash:row.payload_hash};
 const proof={...fields,signature:sign(null,Buffer.from(protocol.stockEventMessage(fields)),pair.privateKey).toString("base64url")};
 return{id:row.id,payloadHash:row.payload_hash,payloadJson:row.payload_json,authorProofJson:JSON.stringify(proof),authorState:{allowed:true}};
}
const accept=async(rows=[claim()],branch="a",terminalId=terminal)=>(await db.query<{ack:Record<string,unknown>}>("SELECT pos_stock_history_accept_claims($1,$2,$3,$4::jsonb) ack",[project,branch,terminalId,JSON.stringify(rows)])).rows[0]!.ack;
const count=async(table:string)=>(await db.query<{n:number}>("SELECT count(*)::int n FROM "+table)).rows[0]!.n;
describe("service-only exact stock claim and accepted-effect admission",()=>{
 it("atomically records existing actual effects once and returns the exact ACK without reapplying stock",async()=>{
  await effect();const row=claim(),ack=await accept();expect(ack).toMatchObject({ok:true,version:1,branchId:"a",terminalId:terminal,receipts:[{id:row.id,payloadHash:row.payloadHash,ingestedCursor:"1"}]});
  expect(await count("stock_history_movements")).toBe(1);expect(await count("private.stock_history_effect_coverage")).toBe(1);expect(await count("private.stock_history_claim_receipts")).toBe(1);
  expect((await db.query("SELECT stock_by_store,price,stock_quantity FROM products")).rows[0]).toEqual({stock_by_store:{a:2,b:2},price:"19.95",stock_quantity:5});
  expect((await db.query("SELECT clock_state,effective_at_raw,payload_json FROM stock_history_movements")).rows[0]).toEqual({clock_state:"unverified",effective_at_raw:at,payload_json:row.payloadJson});
 });
 it("acknowledges exact accepted replay after original author revocation without new writes",async()=>{
  await effect();const ack=await accept();await db.exec("UPDATE app_users SET is_active=false;UPDATE pos_sync_private.shift_author_keys SET revoked_at=now()");
  const row=claim();row.authorState.allowed=false;expect(await accept([row])).toEqual(ack);expect(await count("stock_history_movements")).toBe(1);
 });
 it("never consumes one physical effect twice under a different operation or movement",async()=>{
  await effect();await accept();await expect(accept([claim(other)])).rejects.toThrow(/EFFECT_ALREADY_CONSUMED/);expect(await count("stock_history_movements")).toBe(1);
 });
 it.each(["inactive","revoked","permission","page","case-code","worker denial"])("holds new claims for %s without touching stock",async reason=>{
  await effect();const row=claim();if(reason==="inactive")await db.exec("UPDATE app_users SET is_active=false");if(reason==="revoked")await db.exec("UPDATE pos_sync_private.shift_author_keys SET revoked_at=now()");
  if(reason==="permission")await db.exec("UPDATE app_users SET permissions='{}'");if(reason==="page")await db.exec("UPDATE app_users SET permissions='{\"can_process_sale\":true,\"page:register\":false}'");
  if(reason==="case-code")await db.exec("UPDATE app_users SET store_id='A'");if(reason==="worker denial")row.authorState.allowed=false;
  await expect(accept([row])).rejects.toThrow(/AUTHOR_PERMISSION_REVOKED/);expect(await count("stock_history_movements")).toBe(0);expect(await count("private.stock_history_effect_coverage")).toBe(0);
 });
 it("does not require report/inventory/export permission for a cashier's accepted sale",async()=>{
  await effect();expect(await accept()).toMatchObject({ok:true});
  expect((await db.query("SELECT permissions FROM app_users")).rows[0]).toEqual({permissions:{can_process_sale:true}});
 });
 it("denies missing physical stock effect and rejects a receipt-only source",async()=>{
  await db.exec(`INSERT INTO stock_delta_applied VALUES('${source}','${product}','a',-1)`);await expect(accept()).rejects.toThrow(/SOURCE_NOT_ACCEPTED/);expect(await count("stock_history_movements")).toBe(0);
 });
 it('holds a generic accepted delta when original action/author/document provenance is absent',async()=>{
  await effect(false);await expect(accept()).rejects.toThrow(/SOURCE_ORIGIN_UNPROVEN/);expect(await count('stock_history_movements')).toBe(0);
 });
 it.each(['author','sequence','document','item delta','activity type','reference','other transaction'])('requires exact accepted source %s rather than trusting the stock signature alone',async field=>{
  await effect();
  if(field==='author')await db.exec(`UPDATE fin62_history_preparation.nodes SET proof=jsonb_set(proof,'{authorId}','"${other}"')`);
  if(field==='sequence')await db.exec('UPDATE fin62_history_preparation.publications SET stream_sequence=2');
  if(field==='document')await db.exec(`UPDATE fin62_history_preparation.sale_birth_claims SET sale_id='${other}'`);
  if(field==='other transaction')await db.exec('UPDATE fin62_history_preparation.publications SET capture_xid=pg_current_xact_id()');
  if(['item delta','activity type','reference'].includes(field)){
   const saved=(await db.query<{operations:Array<{table:string;rows:Array<Record<string,unknown>>}>}>('SELECT operations FROM fin62_history_preparation.business_receipts')).rows[0]!.operations;
   const item=field==='item delta'?saved[1]!.rows[0]!:saved[2]!.rows[0]!;
   if(field==='item delta')item.quantity=2;if(field==='activity type')item.activity_type='adjustment';if(field==='reference')item.reference='OTHER';
   await db.query('UPDATE fin62_history_preparation.business_receipts SET operations=$1::jsonb',[JSON.stringify(saved)]);
  }
  await expect(accept()).rejects.toThrow(/SOURCE_ORIGIN_UNPROVEN/);expect(await count('private.stock_history_effect_coverage')).toBe(0);
 });
 it("rejects foreign scope, changed bytes and false native clock certification",async()=>{
  await effect();await expect(accept(undefined,"b")).rejects.toThrow(/BRANCH_FORBIDDEN/);
  const row=claim();row.payloadJson+=" ";await expect(accept([row])).rejects.toThrow(/AUTHOR_INVALID/);
  const altered=claim(),raw=JSON.parse(altered.payloadJson);raw[15]="verified";altered.payloadJson=JSON.stringify(raw);
  await expect(accept([altered])).rejects.toThrow(/INVALID_CLAIM/);expect(await count("stock_history_movements")).toBe(0);
 });
 it("rolls an entire multi-claim transaction back on one unsupported source",async()=>{
  await effect();await expect(accept([claim(),claim(other)])).rejects.toThrow(/EFFECT_ALREADY_CONSUMED/);
  expect(await count("stock_history_movements")).toBe(0);expect(await count("private.stock_history_effect_coverage")).toBe(0);expect(await count("stock_history_heads")).toBe(0);
 });
 it("rejects changed replay proof bytes even with the original payload hash",async()=>{
  await effect();await accept();const row=claim();row.authorProofJson+=" ";await expect(accept([row])).rejects.toThrow(/REPLAY_CONFLICT/);
 });
 it("preserves private evidence immutability and denies public RPC execution",async()=>{
  await effect();await accept();await expect(db.exec("DELETE FROM private.stock_history_claim_receipts")).rejects.toThrow(/IMMUTABLE/);
  for(const role of ["anon","authenticated"]){await db.exec("SET ROLE "+role);try{await expect(accept()).rejects.toThrow(/permission denied/);}finally{await db.exec("RESET ROLE");}}
  await db.exec("SELECT set_config('request.jwt.claim.role','authenticated',false)");await expect(accept()).rejects.toThrow(/SYNC_FORBIDDEN/);
 });
});
