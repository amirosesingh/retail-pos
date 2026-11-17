"use strict";
// Isolated in-memory PostgreSQL only. No configured connection or credentials.
const fs=require("node:fs"),assert=require("node:assert/strict");
const {PGlite}=require("@electric-sql/pglite");
const canonical=require("../history-scope-canonical.cjs");
const scope=require("../sale-item-sync-scope.cjs");
const registry=require("../../database/sqlserver/schema-registry.json");
const read=name=>fs.readFileSync(name,"utf8").replaceAll("\r\n","\n");
const entries=(block,name,tag)=>JSON.parse(block.split("\n").find(line=>line.startsWith(" "+name+" constant jsonb")).split("$"+tag+"$")[1]);
const uid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
async function createSaleItemScopeFixture(){
 const db=new PGlite();
 const history=canonical.historyScopeCanonicalBlock(read("supabase/migrations/20261107021328_isolate_branch_history_sync.sql"));
 const transport=canonical.scopedHistoryTransportCanonicalBlock(read("supabase/migrations/20261107094311_add_scoped_history_transport.sql"),history);
 const expected=entries(history,"expected","history_scope_data"),desired=entries(history,"desired","history_scope_data"),targets=entries(transport,"targets","history_transport_data");
 await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TYPE public.app_role AS ENUM('admin','staff','manager','supervisor');");
 for(const table of registry.tables){
  const keys=table.columns.filter(c=>c.primaryKey).map(c=>'"'+c.cloudColumn+'"');
  await db.exec(`CREATE TABLE public."${table.cloudTable}"(${table.columns.map(c=>'"'+c.cloudColumn+'" '+c.cloudType).join(',')}${keys.length?',PRIMARY KEY('+keys.join(',')+')':''});`);
 }
 await db.exec(`ALTER TABLE sale_items ADD CONSTRAINT sale_items_fixture_sale_fk FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE;
 CREATE TABLE public.sync_change_feed(cursor bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text,table_name text NOT NULL,entity_id text NOT NULL,operation text NOT NULL,row_version bigint NOT NULL DEFAULT 1,tombstone boolean NOT NULL DEFAULT false);
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
 CREATE FUNCTION public.pos_sync_validate_read_scope(p_org text,p_branch text,p_terminal text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF p_org<>'default' OR p_branch NOT IN ('A','B') OR p_terminal NOT IN ('terminal','manager') THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF;END$$;
 CREATE FUNCTION public.pos_sync_validate_scope(p_org text,p_branch text,p_terminal text) RETURNS void LANGUAGE sql AS $$SELECT public.pos_sync_validate_read_scope(p_org,p_branch,p_terminal)$$;
 CREATE FUNCTION public.pos_sync_history_company_scope_v1(p_org text,p_branch text,p_terminal text) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN PERFORM public.pos_sync_validate_read_scope(p_org,p_branch,p_terminal); RETURN p_terminal='manager'; END$$;
 CREATE FUNCTION public.pos_sync_history_company_scope_transport_v1(p_org text,p_branch text,p_terminal text) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN PERFORM public.pos_sync_validate_read_scope(p_org,p_branch,p_terminal); RETURN p_terminal='manager'; END$$;
 CREATE FUNCTION public.pos_sync_history_row_visible_v1(p_company boolean,p_org text,p_branch text,p_row_org text,p_scope text,p_id text) RETURNS boolean LANGUAGE sql AS $$SELECT p_row_org=p_org AND(p_company OR p_scope='BRANCH' AND p_id=p_branch)$$;
 CREATE FUNCTION public.pos_sync_history_row_visible_transport_v1(p_company boolean,p_org text,p_branch text,p_row_org text,p_scope text,p_id text) RETURNS boolean LANGUAGE sql AS $$SELECT public.pos_sync_history_row_visible_v1(p_company,p_org,p_branch,p_row_org,p_scope,p_id)$$;
 CREATE FUNCTION public.product_available_in_catalogue(p_id uuid,p_branch text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION public.catalogue_product_ids_for_branch(p_branch text) RETURNS SETOF uuid LANGUAGE sql AS $$SELECT id FROM products$$;`);
 const routines=[...desired,...targets];
 const take=name=>routines.find(r=>r.signature.startsWith(name+'('));
 const install=async routine=>db.exec(routine.definition.replace('CREATE FUNCTION public.','CREATE OR REPLACE FUNCTION public.'));
 for(const name of ['pos_sync_bootstrap_scoped','pos_sync_pull','pos_sync_pull_history_v2','pos_sync_history_page_v1','pos_sync_feed_page_v1','pos_sync_feed_page_v2','pos_sync_counts','pos_sync_counts_history_v2'])await install(take(name));
 let countDef=expected.find(r=>r.signature.startsWith('pos_sync_counts_scoped(')).definition;
 for(const [before,after] of [
  ['FROM public."issued_vouchers" x WHERE x.store_id::text=p_branch_id','FROM public."issued_vouchers" x WHERE true'],
  ['EXISTS(SELECT 1 FROM public."products" p WHERE p."id"::text=x."product_id"::text AND public.product_available_in_catalogue(p.id,p_branch_id))','x.product_id IN (SELECT public.catalogue_product_ids_for_branch(p_branch_id))'],
  ['public.product_available_in_catalogue(x.id,p_branch_id)','x.id IN (SELECT public.catalogue_product_ids_for_branch(p_branch_id))'],
  ['x WHERE true;\nEND $function$','x WHERE true UNION ALL SELECT \'change_history\'::text table_name,count(*)::bigint row_count FROM public."change_history" x WHERE true;\nEND $function$'],
 ])countDef=countDef.replaceAll(before,after);
 await db.exec(countDef);
 const schema=read('supabase/schema.sql'),start=schema.indexOf('CREATE OR REPLACE FUNCTION public.sync_feed_sale_items()');
 await db.exec(schema.slice(start,schema.indexOf('$trg$;',start)+7));
 await db.exec('CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE ON sale_items FOR EACH ROW EXECUTE FUNCTION sync_feed_sale_items();');
 // The scope proof tests do not invoke business write RPCs. Use isolated
 // prototypes with their real signatures/parent-apply anchors, substituting
 // only those two fixture fingerprints in the migration text below.
 for(const [name,args,rows]of[
  ['pos_sync_push_batch','p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_table text,p_rows jsonb,p_changes jsonb','p_rows'],
  ['pos_sync_push_aggregate','p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_operations jsonb','v_rows'],
 ])await db.exec(`CREATE FUNCTION public.${name}(${args}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$DECLARE v_count integer;v_rows jsonb;BEGIN IF false THEN v_count:=public.sync_apply_sale_items(${rows});END IF;RETURN '{}'::jsonb;END$$;`);
 const componentStart=schema.indexOf(scope.BEGIN),componentEnd=schema.indexOf(scope.END,componentStart);
 assert(componentStart>=0&&componentEnd>componentStart,'Canonical sale-item component is present');
 let sql=schema.slice(componentStart,componentEnd+scope.END.length)+'\n';
 assert.equal(sql,scope.render(),'Effective canonical component matches source');
 assert.equal(read('supabase/migrations/'+scope.MIGRATION),sql,'Portable migration matches effective canonical component');
 for(const item of scope.patches()){
  const actual=(await db.query('SELECT md5(pg_get_functiondef($1::regprocedure)) hash',['public.'+item.signature])).rows[0].hash;
  if(item.signature.startsWith('pos_sync_push_'))sql=sql.replace(item.hash,actual);
  else assert.equal(actual,item.hash,'Reviewed read source fingerprint: '+item.signature);
 }
 const capture=(await db.query("SELECT md5(pg_get_functiondef('public.sync_feed_sale_items()'::regprocedure)) hash")).rows[0].hash;
 assert.equal(capture,'de9ec7e9c933a6a713fece5b36fa31b7');
 const apply=async()=>{await db.exec('BEGIN');try{await db.exec(sql);await db.exec('COMMIT');}catch(error){await db.exec('ROLLBACK');throw error;}};
 return{db,apply,sql,uid};
}
module.exports={createSaleItemScopeFixture};
