"use strict";
// Deterministic source preparation only. This module never connects to a DB.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname,"..");
const MIGRATION = "20261117045120_sale_item_parent_sync_scope.sql";
const BEGIN = "-- SALE_ITEM_PARENT_SYNC_SCOPE_V1_BEGIN", END = "-- SALE_ITEM_PARENT_SYNC_SCOPE_V1_END";
const md5 = text => createHash("md5").update(text).digest("hex");
const quote = value => "'" + value.replaceAll("'","''") + "'";
const json = value => "$sale_scope_json$" + JSON.stringify(value) + "$sale_scope_json$::jsonb";
const parentPredicate = (alias="x",branch="p_branch_id") => `EXISTS(SELECT 1 FROM public.sales sale_parent WHERE sale_parent.id=${alias}.sale_id AND sale_parent.store_id=${branch} AND (NULLIF(btrim(${alias}.branch_id),'') IS NULL OR ${alias}.branch_id=sale_parent.store_id))`;
const parentGuard = rows => `IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(${rows},'[]'::jsonb)) sale_item_input WHERE NOT EXISTS(SELECT 1 FROM public.sales sale_parent WHERE sale_parent.id=(sale_item_input->>'sale_id')::uuid AND sale_parent.store_id=p_branch_id) OR sale_item_input->>'branch_id' IS DISTINCT FROM p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; `;

const helpers = [
  {name:"pos_sync_assert_sale_item_scope_v1",args:"text",definer:false,volatility:"s",body:`
BEGIN
 IF EXISTS(SELECT 1 FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id
  WHERE s.store_id=p_branch AND NULLIF(btrim(i.branch_id),'') IS NOT NULL AND i.branch_id IS DISTINCT FROM s.store_id)
 THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_MISMATCH'; END IF;
END;`,header:"p_branch text",returns:"void"},
  {name:"pos_sync_sale_item_feed_visible_v1",args:"uuid,text,boolean",definer:false,volatility:"s",body:`
DECLARE owner_branch text; child_branch text; proof_branches text[];
BEGIN
 SELECT s.store_id,i.branch_id INTO owner_branch,child_branch FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE i.id=p_item;
 IF FOUND THEN
  -- A current row cannot prove the owner of an older deletion after ID reuse.
  -- Classify that ambiguity before treating a foreign current owner as a skip.
  IF p_tombstone THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_TOMBSTONE_REVIEW'; END IF;
  IF owner_branch IS DISTINCT FROM p_branch THEN RETURN false; END IF;
  IF NULLIF(btrim(child_branch),'') IS NOT NULL AND child_branch IS DISTINCT FROM owner_branch
  THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_MISMATCH'; END IF;
  RETURN true;
 END IF;
 SELECT array_agg(DISTINCT f.branch_id) INTO proof_branches FROM public.sync_change_feed f
 WHERE f.organization_id='default' AND f.table_name='sale_items' AND f.sale_parent_scope_verified
  AND f.tombstone AND f.branch_id<>'global' AND f.entity_id=jsonb_build_object('id',p_item)::text;
 IF COALESCE(cardinality(proof_branches),0)<>1 THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_UNVERIFIED'; END IF;
 -- A proved final deletion supersedes its old upserts. Do not return a NULL
 -- upsert payload or let an unknown old global tombstone delete another branch.
 RETURN p_tombstone AND proof_branches[1]=p_branch;
END;`,header:"p_item uuid,p_branch text,p_tombstone boolean",returns:"boolean"},
  {name:"pos_sync_sale_items_parent_delete_v1",args:"",definer:true,volatility:"v",body:`
BEGIN
 IF NULLIF(btrim(OLD.store_id),'') IS NULL THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_UNVERIFIED'; END IF;
 IF EXISTS(SELECT 1 FROM public.sale_items i WHERE i.sale_id=OLD.id AND NULLIF(btrim(i.branch_id),'') IS NOT NULL AND i.branch_id IS DISTINCT FROM OLD.store_id)
 THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_MISMATCH'; END IF;
 INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone,sale_parent_scope_verified)
 SELECT 'default',OLD.store_id,NULL,'sale_items',jsonb_build_object('id',i.id)::text,'delete',i.row_version,true,true
 FROM public.sale_items i WHERE i.sale_id=OLD.id;
 RETURN OLD;
END;`,header:"",returns:"trigger"},
];
const captureBody = `
DECLARE owner_branch text; child_sale uuid; child_branch text;
BEGIN
 child_sale:=CASE WHEN TG_OP='DELETE' THEN OLD.sale_id ELSE NEW.sale_id END;
 child_branch:=CASE WHEN TG_OP='DELETE' THEN OLD.branch_id ELSE NEW.branch_id END;
 SELECT store_id INTO owner_branch FROM public.sales WHERE id=child_sale;
 IF NOT FOUND THEN
  -- The parent's BEFORE DELETE trigger already published its children using
  -- OLD.store_id. Its FK cascade must not invent global child tombstones.
  IF TG_OP='DELETE' THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_UNVERIFIED';
 END IF;
 IF NULLIF(btrim(owner_branch),'') IS NULL THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_UNVERIFIED'; END IF;
 IF NULLIF(btrim(child_branch),'') IS NOT NULL AND child_branch IS DISTINCT FROM owner_branch
 THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_MISMATCH'; END IF;
 INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone,sale_parent_scope_verified)
 VALUES('default',owner_branch,NULL,'sale_items',CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD.id)::text ELSE jsonb_build_object('id',NEW.id)::text END,
  lower(TG_OP),CASE WHEN TG_OP='DELETE' THEN OLD.row_version ELSE NEW.row_version END,TG_OP='DELETE',true);
 RETURN NULL;
END;`;
function definition(entry) {
  return `CREATE OR REPLACE FUNCTION public.${entry.name}(${entry.header}) RETURNS ${entry.returns}\nLANGUAGE plpgsql ${entry.volatility==="s"?"STABLE ":""}SECURITY ${entry.definer?"DEFINER":"INVOKER"} SET search_path=pg_catalog,public AS $sale_scope_fn$${entry.body}\n$sale_scope_fn$;`;
}
function patches() {
  const list = [];
  const add = (signature,hash,changes) => list.push({signature,hash,changes:changes.map(([before,after,count=1])=>({before,after,count}))});
  const visible = " AND CASE WHEN c.table_name='sale_items' THEN public.pos_sync_sale_item_feed_visible_v1(((c.entity_id::jsonb)->>'id')::uuid,p_branch_id,c.tombstone) ELSE true END";
  for(const [signature,hash]of[["pos_sync_pull(text,text,text,bigint,integer)","7948d5af4bac8501f3a5bf501099aa48"],["pos_sync_pull_history_v2(text,text,text,bigint,integer)","34f17c081b8a69e687880c6b67bf7217"]])
    add(signature,hash,[["AND c.cursor>p_after_cursor","AND c.cursor>p_after_cursor"+visible,2],[`WHEN 'sale_items' THEN (SELECT to_jsonb(x) FROM public."sale_items" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)`,`WHEN 'sale_items' THEN (SELECT to_jsonb(x) FROM public."sale_items" x WHERE x."id"=((f.entity_id::jsonb)->>'id')::uuid AND ${parentPredicate()} LIMIT 1)`]]);
  add("pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)","17052aaeafd6e1437d5b8de27a16a6ee",[
    ["WHEN 'sale_items' THEN SELECT","WHEN 'sale_items' THEN PERFORM public.pos_sync_assert_sale_item_scope_v1(p_branch_id); SELECT"],
    ['FROM public."sale_items" x WHERE (x.branch_id::text=p_branch_id)',`FROM public."sale_items" x WHERE (${parentPredicate()})`],
  ]);
  add("pos_sync_counts_scoped(text,text,text,integer)","cc0d68802ee50a57c8e6e79e92d23edb",[
    [" RETURN QUERY "," PERFORM public.pos_sync_assert_sale_item_scope_v1(p_branch_id);\n RETURN QUERY "],
    ['FROM public."sale_items" x WHERE x.branch_id::text=p_branch_id',`FROM public."sale_items" x WHERE ${parentPredicate()}`],
  ]);
  add("pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)","73bd4c2cb1e3b94cb040e2f041d26d18",[["v_count:=public.sync_apply_sale_items(p_rows)",parentGuard("p_rows")+"v_count:=public.sync_apply_sale_items(p_rows)"]]);
  add("pos_sync_push_aggregate(uuid,text,text,text,jsonb)","f2cafa198ab7f6f8709ffe0caa3c4d46",[["v_count:=public.sync_apply_sale_items(v_rows)",parentGuard("v_rows")+"v_count:=public.sync_apply_sale_items(v_rows)"]]);
  return list;
}
const pins = [
  {signature:"pos_sync_history_page_v1(text,text,text,text,integer,boolean,integer)",hash:"06e9c1c2811c9ae1dace1a1e18da873d",callee:"pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)",old:"17052aaeafd6e1437d5b8de27a16a6ee"},
  {signature:"pos_sync_feed_page_v1(text,text,text,bigint,boolean,integer)",hash:"0e2ab427d8e7c867539ca27a195e8071",callee:"pos_sync_pull(text,text,text,bigint,integer)",old:"7948d5af4bac8501f3a5bf501099aa48"},
  {signature:"pos_sync_feed_page_v2(text,text,text,bigint,boolean,integer)",hash:"63ed67059d53024429eee713d4999eef",callee:"pos_sync_pull_history_v2(text,text,text,bigint,integer)",old:"34f17c081b8a69e687880c6b67bf7217"},
];
function render() {
  const newHelpers = helpers.map(entry=>({...entry,signature:entry.name+"("+entry.args+")",bodyHash:md5(entry.body+"\n"),definition:definition(entry)}));
  const capture = {name:"sync_feed_sale_items",header:"",returns:"trigger",definer:true,volatility:"v",body:captureBody};
  return `${BEGIN}
-- Prepared additive scope repair. No business rows, pending work or cursors
-- are rewritten. One transaction is owned by the migration caller.
DO $sale_scope_prepare$
DECLARE actual text; entry jsonb; fn oid; helper_count integer:=0; has_scope_flag boolean;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_OWNER_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.sale_items'::regclass AND c.confrelid='public.sales'::regclass AND c.contype='f' AND c.confdeltype='c' AND c.convalidated
  AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.sale_items'::regclass AND attname='sale_id' AND NOT attisdropped)]::smallint[]
  AND c.confkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.sales'::regclass AND attname='id' AND NOT attisdropped)]::smallint[])
 THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_PARENT_SHAPE'; END IF;
 -- Existing same-name helpers must be exactly ours, not silently replaced.
 FOR entry IN SELECT value FROM jsonb_array_elements(${json(newHelpers)}) LOOP
  fn:=to_regprocedure('public.'||(entry->>'signature'));
  IF fn IS NOT NULL THEN helper_count:=helper_count+1; END IF;
  IF fn IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=fn AND md5(p.prosrc)=entry->>'bodyHash' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=(entry->>'definer')::boolean AND p.provolatile::text=entry->>'volatility'
   AND p.prokind='f' AND l.lanname='plpgsql' AND p.proconfig=ARRAY['search_path=pg_catalog, public']
   AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
   AND has_function_privilege('service_role',p.oid,'EXECUTE')=(entry->>'returns'<>'trigger'))
  THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_HELPER_CHANGED'; END IF;
 END LOOP;
 fn:=to_regprocedure('public.sync_feed_sale_items()');
 IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND
   (md5(pg_get_functiondef(p.oid))='de9ec7e9c933a6a713fece5b36fa31b7' OR (md5(p.prosrc)=${quote(md5(captureBody+"\n"))} AND p.proconfig=ARRAY['search_path=pg_catalog, public'] AND p.provolatile='v')))
 THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_CAPTURE_CHANGED'; END IF;
 SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.sync_change_feed'::regclass AND attname='sale_parent_scope_verified' AND NOT attisdropped) INTO has_scope_flag;
 IF has_scope_flag AND (helper_count<>${helpers.length} OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=fn)<>${quote(md5(captureBody+"\n"))})
  OR NOT has_scope_flag AND helper_count<>0 THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_PARTIAL_COMPONENT'; END IF;
 IF has_scope_flag AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='public.sync_change_feed'::regclass AND a.attname='sale_parent_scope_verified' AND NOT a.attisdropped
   AND a.atttypid='boolean'::regtype AND a.attnotnull AND pg_get_expr(d.adbin,d.adrelid)='false')
 THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_FEED_SHAPE'; END IF;
 IF to_regclass('public.sync_sale_item_scope_proof_v1') IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_am am ON am.oid=idx.relam
  WHERE i.indexrelid=to_regclass('public.sync_sale_item_scope_proof_v1') AND i.indrelid='public.sync_change_feed'::regclass
   AND i.indisvalid AND i.indisready AND NOT i.indisunique AND i.indnkeyatts=3 AND i.indnatts=3 AND am.amname='btree'
   AND i.indkey::text=(SELECT string_agg(a.attnum::text,' ' ORDER BY n) FROM unnest(ARRAY['organization_id','entity_id','branch_id']) WITH ORDINALITY names(name,n) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname=names.name)
   AND pg_get_expr(i.indpred,i.indrelid)='((table_name = ''sale_items''::text) AND sale_parent_scope_verified AND tombstone)')
 THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_PROOF_INDEX_CHANGED'; END IF;
END $sale_scope_prepare$;

ALTER TABLE public.sync_change_feed ADD COLUMN IF NOT EXISTS sale_parent_scope_verified boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS sync_sale_item_scope_proof_v1 ON public.sync_change_feed(organization_id,entity_id,branch_id)
 WHERE table_name='sale_items' AND sale_parent_scope_verified AND tombstone;

${newHelpers.map(entry=>entry.definition+"\nREVOKE ALL ON FUNCTION public."+entry.signature+" FROM PUBLIC,anon,authenticated,service_role;"+(entry.returns!=="trigger"?"\nGRANT EXECUTE ON FUNCTION public."+entry.signature+" TO service_role;":"")).join("\n\n")}

${definition(capture)}

DO $sale_scope_contracts$
DECLARE entry jsonb; patch jsonb; fn oid; original text; changed text; reverted text; before_text text; after_text text; expected_count integer; new_hash text;
BEGIN
 FOR entry IN SELECT value FROM jsonb_array_elements(${json(patches())}) LOOP
  fn:=to_regprocedure('public.'||(entry->>'signature'));
  IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=fn AND pg_get_userbyid(p.proowner)='postgres' AND l.lanname='plpgsql' AND p.prosecdef)
  THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_RPC_METADATA'; END IF;
  original:=pg_get_functiondef(fn); changed:=original;
  IF md5(original)=entry->>'hash' THEN
   FOR patch IN SELECT value FROM jsonb_array_elements(entry->'changes') LOOP
    before_text:=patch->>'before'; after_text:=patch->>'after'; expected_count:=(patch->>'count')::integer;
    IF (length(changed)-length(replace(changed,before_text,'')))/length(before_text)<>expected_count THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_RPC_ANCHOR'; END IF;
    changed:=replace(changed,before_text,after_text);
   END LOOP;
   EXECUTE replace(changed,'CREATE FUNCTION public.','CREATE OR REPLACE FUNCTION public.');
  ELSE
   -- Replay accepts only the exact reversible transformation of the known
   -- predecessor, not a marker or a broadly similar unreviewed routine.
   reverted:=original;
   FOR patch IN SELECT value FROM jsonb_array_elements(entry->'changes') WITH ORDINALITY x(value,n) ORDER BY n DESC LOOP
    before_text:=patch->>'before'; after_text:=patch->>'after'; expected_count:=(patch->>'count')::integer;
    IF (length(reverted)-length(replace(reverted,after_text,'')))/length(after_text)<>expected_count THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_RPC_CHANGED'; END IF;
    reverted:=replace(reverted,after_text,before_text);
   END LOOP;
   IF md5(reverted)<>entry->>'hash' THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_RPC_CHANGED'; END IF;
  END IF;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(${json(pins)}) LOOP
  fn:=to_regprocedure('public.'||(entry->>'signature'));
  IF fn IS NULL THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_WRAPPER_MISSING'; END IF;
  original:=pg_get_functiondef(fn); new_hash:=md5(pg_get_functiondef(to_regprocedure('public.'||(entry->>'callee'))));
  IF md5(original)=entry->>'hash' THEN
   IF (length(original)-length(replace(original,entry->>'old','')))/length(entry->>'old')<>1 THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_WRAPPER_ANCHOR'; END IF;
   changed:=replace(original,entry->>'old',new_hash);
   EXECUTE replace(changed,'CREATE FUNCTION public.','CREATE OR REPLACE FUNCTION public.');
  ELSE
   reverted:=replace(original,new_hash,entry->>'old');
   IF md5(reverted)<>entry->>'hash' THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_WRAPPER_CHANGED'; END IF;
  END IF;
 END LOOP;
END $sale_scope_contracts$;

DO $sale_scope_trigger$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.sales'::regclass AND tgname='sync_sale_items_parent_delete_v1' AND
  (tgfoid<>'public.pos_sync_sale_items_parent_delete_v1()'::regprocedure OR tgtype<>11 OR tgenabled<>'O'
   OR tgqual IS NOT NULL OR tgnargs<>0 OR tgisinternal OR tgconstraint<>0 OR tgconstrrelid<>0 OR tgdeferrable OR tginitdeferred OR tgoldtable IS NOT NULL OR tgnewtable IS NOT NULL))
 THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_DELETE_TRIGGER_CHANGED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.sales'::regclass AND tgname='sync_sale_items_parent_delete_v1') THEN
  CREATE TRIGGER sync_sale_items_parent_delete_v1 BEFORE DELETE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.pos_sync_sale_items_parent_delete_v1();
 END IF;
END $sale_scope_trigger$;
${END}
`;
}
function withSaleItemScope(schema) {
  if(schema.includes(BEGIN)){
    if(schema.split(BEGIN).length!==2||schema.split(END).length!==2||schema.indexOf(END)<schema.indexOf(BEGIN))throw Error("Sale-item scope assembly boundary changed");
    schema=schema.slice(0,schema.indexOf(BEGIN)).trimEnd()+"\n\n"+schema.slice(schema.indexOf(END)+END.length).trimStart();
  }
  const anchor="-- Final public-schema privilege hardening after notification rule definitions.";
  if(schema.split(anchor).length!==2)throw Error("Sale-item scope final hardening anchor changed");
  return schema.replace(anchor,render()+"\n"+anchor);
}
module.exports={MIGRATION,BEGIN,END,parentPredicate,parentGuard,helpers,captureBody,definition,patches,pins,render,withSaleItemScope};
if(require.main===module){
 const target=path.join(root,"supabase/migrations",MIGRATION);
 if(!fs.existsSync(target))throw Error("Create migration using the Supabase CLI first");
 fs.writeFileSync(target,render(),"utf8");
 console.log("Prepared only "+path.relative(root,target));
}
