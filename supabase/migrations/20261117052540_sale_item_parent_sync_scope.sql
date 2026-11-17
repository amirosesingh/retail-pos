-- SALE_ITEM_PARENT_SYNC_SCOPE_V1_BEGIN
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
 FOR entry IN SELECT value FROM jsonb_array_elements($sale_scope_json$[{"name":"pos_sync_assert_sale_item_scope_v1","args":"text","definer":false,"volatility":"s","body":"\nBEGIN\n IF EXISTS(SELECT 1 FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id\n  WHERE s.store_id=p_branch AND NULLIF(btrim(i.branch_id),'') IS NOT NULL AND i.branch_id IS DISTINCT FROM s.store_id)\n THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_MISMATCH'; END IF;\nEND;","header":"p_branch text","returns":"void","signature":"pos_sync_assert_sale_item_scope_v1(text)","bodyHash":"81f965a23877c4bf87a3106f070e691d","definition":"CREATE OR REPLACE FUNCTION public.pos_sync_assert_sale_item_scope_v1(p_branch text) RETURNS void\nLANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $sale_scope_fn$\nBEGIN\n IF EXISTS(SELECT 1 FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id\n  WHERE s.store_id=p_branch AND NULLIF(btrim(i.branch_id),'') IS NOT NULL AND i.branch_id IS DISTINCT FROM s.store_id)\n THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_MISMATCH'; END IF;\nEND;\n$sale_scope_fn$;"},{"name":"pos_sync_sale_item_feed_visible_v1","args":"uuid,text,boolean","definer":false,"volatility":"s","body":"\nDECLARE owner_branch text; child_branch text; proof_branches text[];\nBEGIN\n SELECT s.store_id,i.branch_id INTO owner_branch,child_branch FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE i.id=p_item;\n IF FOUND THEN\n  -- A current row cannot prove the owner of an older deletion after ID reuse.\n  -- Classify that ambiguity before treating a foreign current owner as a skip.\n  IF p_tombstone THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_TOMBSTONE_REVIEW'; END IF;\n  IF owner_branch IS DISTINCT FROM p_branch THEN RETURN false; END IF;\n  IF NULLIF(btrim(child_branch),'') IS NOT NULL AND child_branch IS DISTINCT FROM owner_branch\n  THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_MISMATCH'; END IF;\n  RETURN true;\n END IF;\n SELECT array_agg(DISTINCT f.branch_id) INTO proof_branches FROM public.sync_change_feed f\n WHERE f.organization_id='default' AND f.table_name='sale_items' AND f.sale_parent_scope_verified\n  AND f.tombstone AND f.branch_id<>'global' AND f.entity_id=jsonb_build_object('id',p_item)::text;\n IF COALESCE(cardinality(proof_branches),0)<>1 THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_UNVERIFIED'; END IF;\n -- A proved final deletion supersedes its old upserts. Do not return a NULL\n -- upsert payload or let an unknown old global tombstone delete another branch.\n RETURN p_tombstone AND proof_branches[1]=p_branch;\nEND;","header":"p_item uuid,p_branch text,p_tombstone boolean","returns":"boolean","signature":"pos_sync_sale_item_feed_visible_v1(uuid,text,boolean)","bodyHash":"a5f2ce7cd571fb4da101cb2467b28857","definition":"CREATE OR REPLACE FUNCTION public.pos_sync_sale_item_feed_visible_v1(p_item uuid,p_branch text,p_tombstone boolean) RETURNS boolean\nLANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $sale_scope_fn$\nDECLARE owner_branch text; child_branch text; proof_branches text[];\nBEGIN\n SELECT s.store_id,i.branch_id INTO owner_branch,child_branch FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id WHERE i.id=p_item;\n IF FOUND THEN\n  -- A current row cannot prove the owner of an older deletion after ID reuse.\n  -- Classify that ambiguity before treating a foreign current owner as a skip.\n  IF p_tombstone THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_TOMBSTONE_REVIEW'; END IF;\n  IF owner_branch IS DISTINCT FROM p_branch THEN RETURN false; END IF;\n  IF NULLIF(btrim(child_branch),'') IS NOT NULL AND child_branch IS DISTINCT FROM owner_branch\n  THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_MISMATCH'; END IF;\n  RETURN true;\n END IF;\n SELECT array_agg(DISTINCT f.branch_id) INTO proof_branches FROM public.sync_change_feed f\n WHERE f.organization_id='default' AND f.table_name='sale_items' AND f.sale_parent_scope_verified\n  AND f.tombstone AND f.branch_id<>'global' AND f.entity_id=jsonb_build_object('id',p_item)::text;\n IF COALESCE(cardinality(proof_branches),0)<>1 THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_UNVERIFIED'; END IF;\n -- A proved final deletion supersedes its old upserts. Do not return a NULL\n -- upsert payload or let an unknown old global tombstone delete another branch.\n RETURN p_tombstone AND proof_branches[1]=p_branch;\nEND;\n$sale_scope_fn$;"},{"name":"pos_sync_sale_items_parent_delete_v1","args":"","definer":true,"volatility":"v","body":"\nBEGIN\n IF NULLIF(btrim(OLD.store_id),'') IS NULL THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_UNVERIFIED'; END IF;\n IF EXISTS(SELECT 1 FROM public.sale_items i WHERE i.sale_id=OLD.id AND NULLIF(btrim(i.branch_id),'') IS NOT NULL AND i.branch_id IS DISTINCT FROM OLD.store_id)\n THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_MISMATCH'; END IF;\n INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone,sale_parent_scope_verified)\n SELECT 'default',OLD.store_id,NULL,'sale_items',jsonb_build_object('id',i.id)::text,'delete',i.row_version,true,true\n FROM public.sale_items i WHERE i.sale_id=OLD.id;\n RETURN OLD;\nEND;","header":"","returns":"trigger","signature":"pos_sync_sale_items_parent_delete_v1()","bodyHash":"a9d2d6ca8cd6914bbd80f7e2550075a3","definition":"CREATE OR REPLACE FUNCTION public.pos_sync_sale_items_parent_delete_v1() RETURNS trigger\nLANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $sale_scope_fn$\nBEGIN\n IF NULLIF(btrim(OLD.store_id),'') IS NULL THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_UNVERIFIED'; END IF;\n IF EXISTS(SELECT 1 FROM public.sale_items i WHERE i.sale_id=OLD.id AND NULLIF(btrim(i.branch_id),'') IS NOT NULL AND i.branch_id IS DISTINCT FROM OLD.store_id)\n THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_MISMATCH'; END IF;\n INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone,sale_parent_scope_verified)\n SELECT 'default',OLD.store_id,NULL,'sale_items',jsonb_build_object('id',i.id)::text,'delete',i.row_version,true,true\n FROM public.sale_items i WHERE i.sale_id=OLD.id;\n RETURN OLD;\nEND;\n$sale_scope_fn$;"}]$sale_scope_json$::jsonb) LOOP
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
   (md5(pg_get_functiondef(p.oid))='de9ec7e9c933a6a713fece5b36fa31b7' OR (md5(p.prosrc)='b84684846eca62547abf14db521cc289' AND p.proconfig=ARRAY['search_path=pg_catalog, public'] AND p.provolatile='v')))
 THEN RAISE EXCEPTION 'SALE_ITEM_SCOPE_CAPTURE_CHANGED'; END IF;
 SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.sync_change_feed'::regclass AND attname='sale_parent_scope_verified' AND NOT attisdropped) INTO has_scope_flag;
 IF has_scope_flag AND (helper_count<>3 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=fn)<>'b84684846eca62547abf14db521cc289')
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

CREATE OR REPLACE FUNCTION public.pos_sync_assert_sale_item_scope_v1(p_branch text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $sale_scope_fn$
BEGIN
 IF EXISTS(SELECT 1 FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id
  WHERE s.store_id=p_branch AND NULLIF(btrim(i.branch_id),'') IS NOT NULL AND i.branch_id IS DISTINCT FROM s.store_id)
 THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_MISMATCH'; END IF;
END;
$sale_scope_fn$;
REVOKE ALL ON FUNCTION public.pos_sync_assert_sale_item_scope_v1(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_assert_sale_item_scope_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.pos_sync_sale_item_feed_visible_v1(p_item uuid,p_branch text,p_tombstone boolean) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $sale_scope_fn$
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
END;
$sale_scope_fn$;
REVOKE ALL ON FUNCTION public.pos_sync_sale_item_feed_visible_v1(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_sale_item_feed_visible_v1(uuid,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.pos_sync_sale_items_parent_delete_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $sale_scope_fn$
BEGIN
 IF NULLIF(btrim(OLD.store_id),'') IS NULL THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_UNVERIFIED'; END IF;
 IF EXISTS(SELECT 1 FROM public.sale_items i WHERE i.sale_id=OLD.id AND NULLIF(btrim(i.branch_id),'') IS NOT NULL AND i.branch_id IS DISTINCT FROM OLD.store_id)
 THEN RAISE EXCEPTION 'SYNC_SALE_ITEM_SCOPE_MISMATCH'; END IF;
 INSERT INTO public.sync_change_feed(organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone,sale_parent_scope_verified)
 SELECT 'default',OLD.store_id,NULL,'sale_items',jsonb_build_object('id',i.id)::text,'delete',i.row_version,true,true
 FROM public.sale_items i WHERE i.sale_id=OLD.id;
 RETURN OLD;
END;
$sale_scope_fn$;
REVOKE ALL ON FUNCTION public.pos_sync_sale_items_parent_delete_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.sync_feed_sale_items() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $sale_scope_fn$
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
END;
$sale_scope_fn$;

DO $sale_scope_contracts$
DECLARE entry jsonb; patch jsonb; fn oid; original text; changed text; reverted text; before_text text; after_text text; expected_count integer; new_hash text;
BEGIN
 FOR entry IN SELECT value FROM jsonb_array_elements($sale_scope_json$[{"signature":"pos_sync_pull(text,text,text,bigint,integer)","hash":"7948d5af4bac8501f3a5bf501099aa48","changes":[{"before":"AND c.cursor>p_after_cursor","after":"AND c.cursor>p_after_cursor AND CASE WHEN c.table_name='sale_items' THEN public.pos_sync_sale_item_feed_visible_v1(((c.entity_id::jsonb)->>'id')::uuid,p_branch_id,c.tombstone) ELSE true END","count":2},{"before":"WHEN 'sale_items' THEN (SELECT to_jsonb(x) FROM public.\"sale_items\" x WHERE x.\"id\"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)","after":"WHEN 'sale_items' THEN (SELECT to_jsonb(x) FROM public.\"sale_items\" x WHERE x.\"id\"=((f.entity_id::jsonb)->>'id')::uuid AND EXISTS(SELECT 1 FROM public.sales sale_parent WHERE sale_parent.id=x.sale_id AND sale_parent.store_id=p_branch_id AND (NULLIF(btrim(x.branch_id),'') IS NULL OR x.branch_id=sale_parent.store_id)) LIMIT 1)","count":1}]},{"signature":"pos_sync_pull_history_v2(text,text,text,bigint,integer)","hash":"34f17c081b8a69e687880c6b67bf7217","changes":[{"before":"AND c.cursor>p_after_cursor","after":"AND c.cursor>p_after_cursor AND CASE WHEN c.table_name='sale_items' THEN public.pos_sync_sale_item_feed_visible_v1(((c.entity_id::jsonb)->>'id')::uuid,p_branch_id,c.tombstone) ELSE true END","count":2},{"before":"WHEN 'sale_items' THEN (SELECT to_jsonb(x) FROM public.\"sale_items\" x WHERE x.\"id\"=((f.entity_id::jsonb)->>'id')::uuid LIMIT 1)","after":"WHEN 'sale_items' THEN (SELECT to_jsonb(x) FROM public.\"sale_items\" x WHERE x.\"id\"=((f.entity_id::jsonb)->>'id')::uuid AND EXISTS(SELECT 1 FROM public.sales sale_parent WHERE sale_parent.id=x.sale_id AND sale_parent.store_id=p_branch_id AND (NULLIF(btrim(x.branch_id),'') IS NULL OR x.branch_id=sale_parent.store_id)) LIMIT 1)","count":1}]},{"signature":"pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)","hash":"17052aaeafd6e1437d5b8de27a16a6ee","changes":[{"before":"WHEN 'sale_items' THEN SELECT","after":"WHEN 'sale_items' THEN PERFORM public.pos_sync_assert_sale_item_scope_v1(p_branch_id); SELECT","count":1},{"before":"FROM public.\"sale_items\" x WHERE (x.branch_id::text=p_branch_id)","after":"FROM public.\"sale_items\" x WHERE (EXISTS(SELECT 1 FROM public.sales sale_parent WHERE sale_parent.id=x.sale_id AND sale_parent.store_id=p_branch_id AND (NULLIF(btrim(x.branch_id),'') IS NULL OR x.branch_id=sale_parent.store_id)))","count":1}]},{"signature":"pos_sync_counts_scoped(text,text,text,integer)","hash":"cc0d68802ee50a57c8e6e79e92d23edb","changes":[{"before":" RETURN QUERY ","after":" PERFORM public.pos_sync_assert_sale_item_scope_v1(p_branch_id);\n RETURN QUERY ","count":1},{"before":"FROM public.\"sale_items\" x WHERE x.branch_id::text=p_branch_id","after":"FROM public.\"sale_items\" x WHERE EXISTS(SELECT 1 FROM public.sales sale_parent WHERE sale_parent.id=x.sale_id AND sale_parent.store_id=p_branch_id AND (NULLIF(btrim(x.branch_id),'') IS NULL OR x.branch_id=sale_parent.store_id))","count":1}]},{"signature":"pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)","hash":"73bd4c2cb1e3b94cb040e2f041d26d18","changes":[{"before":"v_count:=public.sync_apply_sale_items(p_rows)","after":"IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) sale_item_input WHERE NOT EXISTS(SELECT 1 FROM public.sales sale_parent WHERE sale_parent.id=(sale_item_input->>'sale_id')::uuid AND sale_parent.store_id=p_branch_id) OR sale_item_input->>'branch_id' IS DISTINCT FROM p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sale_items(p_rows)","count":1}]},{"signature":"pos_sync_push_aggregate(uuid,text,text,text,jsonb)","hash":"f2cafa198ab7f6f8709ffe0caa3c4d46","changes":[{"before":"v_count:=public.sync_apply_sale_items(v_rows)","after":"IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(v_rows,'[]'::jsonb)) sale_item_input WHERE NOT EXISTS(SELECT 1 FROM public.sales sale_parent WHERE sale_parent.id=(sale_item_input->>'sale_id')::uuid AND sale_parent.store_id=p_branch_id) OR sale_item_input->>'branch_id' IS DISTINCT FROM p_branch_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN'; END IF; v_count:=public.sync_apply_sale_items(v_rows)","count":1}]}]$sale_scope_json$::jsonb) LOOP
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
 FOR entry IN SELECT value FROM jsonb_array_elements($sale_scope_json$[{"signature":"pos_sync_history_page_v1(text,text,text,text,integer,boolean,integer)","hash":"06e9c1c2811c9ae1dace1a1e18da873d","callee":"pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)","old":"17052aaeafd6e1437d5b8de27a16a6ee"},{"signature":"pos_sync_feed_page_v1(text,text,text,bigint,boolean,integer)","hash":"0e2ab427d8e7c867539ca27a195e8071","callee":"pos_sync_pull(text,text,text,bigint,integer)","old":"7948d5af4bac8501f3a5bf501099aa48"},{"signature":"pos_sync_feed_page_v2(text,text,text,bigint,boolean,integer)","hash":"63ed67059d53024429eee713d4999eef","callee":"pos_sync_pull_history_v2(text,text,text,bigint,integer)","old":"34f17c081b8a69e687880c6b67bf7217"}]$sale_scope_json$::jsonb) LOOP
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
-- SALE_ITEM_PARENT_SYNC_SCOPE_V1_END
