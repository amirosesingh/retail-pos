import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import type {PGlite as PGliteDatabase} from "@electric-sql/pglite";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
const {PGlite}=createRequire(import.meta.url)("@electric-sql/pglite");
let db:PGliteDatabase;
const terminal="11111111-1111-4111-8111-111111111111",operation="22222222-2222-4222-8222-222222222222",shift="33333333-3333-4333-8333-333333333333";
const project="https://fixture.supabase.co",raw=JSON.stringify({version:1,action:"REFUND",branchId:"A",terminalId:terminal,operationId:operation,shiftId:shift,sequence:"1"});
const digest=createHash("sha256").update(raw).digest("hex"),proof={projectOrigin:project,terminalId:terminal,branchId:"A",operationId:operation,action:"REFUND",payloadHash:digest,signature:"original-signature"};
const ack={status:"financial_metadata_recorded",operationId:operation,payloadHash:digest,sequence:"1",businessUploaded:false,shiftClosed:false};
const call=async(over:Partial<{org:string;branch:string;terminal:string;project:string;raw:string;proof:unknown}>={})=>(await db.query<{result:unknown}>("SELECT public.pos_sync_read_financial_event_receipt($1,$2,$3,$4,$5,$6::jsonb) result",[over.org??"default",over.branch??"A",over.terminal??terminal,over.project??project,over.raw??raw,JSON.stringify(over.proof??proof)])).rows[0].result;
beforeAll(async()=>{
  db=new PGlite();await db.waitReady;
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA fin62_preparation;CREATE SCHEMA fin62_history_preparation;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
    CREATE TABLE terminal_scope(organization_id text,branch_id text,terminal_id text,active boolean);
    INSERT INTO terminal_scope VALUES('default','A','${terminal}',true);
    CREATE FUNCTION public.pos_sync_validate_scope(p_org text,p_branch text,p_terminal text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN IF NOT EXISTS(SELECT 1 FROM public.terminal_scope WHERE organization_id=p_org AND branch_id=p_branch AND terminal_id=p_terminal AND active) THEN RAISE EXCEPTION 'SCOPE_DENIED';END IF;END$$;
    CREATE TABLE fin62_history_preparation.nodes(operation_id uuid PRIMARY KEY,organization_id text,branch_id text,terminal_id text,shift_id uuid,sequence bigint,node_kind text,payload_json text,payload_hash text,proof jsonb,acknowledgement jsonb);`);
  const math=readFileSync("scripts/preparation/shift-financial-math-postgres.sql","utf8"),start=math.indexOf("CREATE OR REPLACE FUNCTION fin62_preparation.math_unique_json("),end=math.indexOf("CREATE OR REPLACE FUNCTION fin62_preparation.math_method",start);
  await db.exec(math.slice(start,end));
  await db.exec(readFileSync("supabase/migrations/20261117233612_native_refund_exact_financial_receipt_probe.sql","utf8"));
});
beforeEach(async()=>{await db.exec("RESET ROLE;SET request.jwt.claim.role='service_role';TRUNCATE fin62_history_preparation.nodes;UPDATE terminal_scope SET active=true;");
  await db.query("INSERT INTO fin62_history_preparation.nodes VALUES($1,'default','A',$2,$3,1,'MUTATION',$4,$5,$6::jsonb,$7::jsonb)",[operation,terminal,shift,raw,digest,JSON.stringify(proof),JSON.stringify(ack)]);});
afterAll(async()=>{await db?.close();});
describe("read-only exact FIN62 refund metadata receipt",()=>{
  it("installs before optional FIN62 tables exist and refuses to acknowledge unavailable history",async()=>{
    const isolated:PGliteDatabase=new PGlite();await isolated.waitReady;
    try{
      await isolated.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA fin62_preparation;
        CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
        CREATE FUNCTION public.pos_sync_validate_scope(p_org text,p_branch text,p_terminal text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
          IF p_org<>'default' OR p_branch<>'A' OR p_terminal<>'${terminal}' THEN RAISE EXCEPTION 'SCOPE_DENIED';END IF;END$$;
        SET request.jwt.claim.role='service_role';`);
      const math=readFileSync("scripts/preparation/shift-financial-math-postgres.sql","utf8"),start=math.indexOf("CREATE OR REPLACE FUNCTION fin62_preparation.math_unique_json("),end=math.indexOf("CREATE OR REPLACE FUNCTION fin62_preparation.math_method",start);
      await isolated.exec(math.slice(start,end));
      await isolated.exec(readFileSync("supabase/migrations/20261117233612_native_refund_exact_financial_receipt_probe.sql","utf8"));
      expect((await isolated.query<{optional:string|null}>("SELECT to_regclass('fin62_history_preparation.nodes')::text optional")).rows[0].optional).toBeNull();
      await expect(isolated.query("SELECT public.pos_sync_read_financial_event_receipt($1,$2,$3,$4,$5,$6::jsonb)",["default","A",terminal,project,raw,JSON.stringify(proof)])).rejects.toThrow(/fin62_history_preparation/);
      expect((await isolated.query<{optional:string|null}>("SELECT to_regclass('fin62_history_preparation.nodes')::text optional")).rows[0].optional).toBeNull();
    }finally{await isolated.close();}
  });
  it("returns only the stored exact metadata ACK without current-author or business authority",async()=>{
    expect(await call()).toEqual(ack);
    expect((await db.query<{count:number}>("SELECT count(*)::int count FROM fin62_history_preparation.nodes")).rows[0].count).toBe(1);
    expect(await call()).toEqual(ack);
  });
  it("returns decisive null for an absent node and creates no event",async()=>{
    await db.exec("TRUNCATE fin62_history_preparation.nodes");expect(await call()).toBeNull();
    expect((await db.query<{count:number}>("SELECT count(*)::int count FROM fin62_history_preparation.nodes")).rows[0].count).toBe(0);
  });
  it("reapplies the known routine without changing saved receipts or widening execution",async()=>{
    const before=(await db.query("SELECT to_jsonb(node) value FROM fin62_history_preparation.nodes node ORDER BY operation_id")).rows;
    await db.exec(readFileSync("supabase/migrations/20261117233612_native_refund_exact_financial_receipt_probe.sql","utf8"));
    expect((await db.query("SELECT to_jsonb(node) value FROM fin62_history_preparation.nodes node ORDER BY operation_id")).rows).toEqual(before);
    expect(await call()).toEqual(ack);
    expect((await db.query<{anonymous:boolean;service:boolean}>("SELECT has_function_privilege('anon','public.pos_sync_read_financial_event_receipt(text,text,text,text,text,jsonb)','EXECUTE') anonymous,has_function_privilege('service_role','public.pos_sync_read_financial_event_receipt(text,text,text,text,text,jsonb)','EXECUTE') service")).rows[0]).toEqual({anonymous:false,service:true});
  });
  it.each(["organization","branch","terminal","project","raw","signature","digest","ack"])("denies changed %s instead of returning a reusable authorization",async kind=>{
    if(kind==="organization")await expect(call({org:"other"})).rejects.toThrow("SCOPE_DENIED");
    if(kind==="branch")await expect(call({branch:"B"})).rejects.toThrow("SCOPE_DENIED");
    if(kind==="terminal")await expect(call({terminal:operation})).rejects.toThrow("SCOPE_DENIED");
    if(kind==="project")await expect(call({project:"https://other.supabase.co"})).rejects.toThrow("FIN62_RECEIPT_INVALID");
    if(kind==="raw")await expect(call({raw:raw+" "})).rejects.toThrow("FIN62_RECEIPT_INVALID");
    if(kind==="signature")await expect(call({proof:{...proof,signature:"forged"}})).rejects.toThrow("FIN62_RECEIPT_REPLAY_MISMATCH");
    if(kind==="digest")await expect(call({proof:{...proof,payloadHash:"a".repeat(64)}})).rejects.toThrow("FIN62_RECEIPT_INVALID");
    if(kind==="ack"){await db.query("UPDATE fin62_history_preparation.nodes SET acknowledgement=$1::jsonb",[JSON.stringify({...ack,businessUploaded:true})]);await expect(call()).rejects.toThrow("FIN62_RECEIPT_REPLAY_MISMATCH");}
  });
  it("rejects duplicate raw keys, malformed scope and revoked terminals",async()=>{
    await expect(call({raw:raw.replace('{','{"version":1,')})).rejects.toThrow("FIN62_DUPLICATE_JSON_KEY");
    await db.exec("UPDATE terminal_scope SET active=false");await expect(call()).rejects.toThrow("SCOPE_DENIED");
  });
  it("restricts execution to service role and pins the definer search path",async()=>{
    const flags=(await db.query<{service:boolean;anonymous:boolean;authenticated:boolean;config:string[]}>(`SELECT has_function_privilege('service_role','public.pos_sync_read_financial_event_receipt(text,text,text,text,text,jsonb)','EXECUTE') service,
      has_function_privilege('anon','public.pos_sync_read_financial_event_receipt(text,text,text,text,text,jsonb)','EXECUTE') anonymous,
      has_function_privilege('authenticated','public.pos_sync_read_financial_event_receipt(text,text,text,text,text,jsonb)','EXECUTE') authenticated,
      proconfig config FROM pg_proc WHERE oid='public.pos_sync_read_financial_event_receipt(text,text,text,text,text,jsonb)'::regprocedure`)).rows[0];
    expect(flags).toEqual({service:true,anonymous:false,authenticated:false,config:["search_path=pg_catalog"]});
    await db.exec("SET ROLE service_role");expect(await call()).toEqual(ack);await db.exec("RESET ROLE;SET request.jwt.claim.role='authenticated'");await expect(call()).rejects.toThrow("FIN62_RECEIPT_SERVICE_REQUIRED");
  });
});
