-- STOCK401 preparation: authoritative single-branch product merge. The paired
-- relay must authenticate the original POS actor and installation before use.
BEGIN;
DO $dependencies$
BEGIN
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('public.product_delete_guard(uuid)')
   AND md5(replace(prosrc,E'\r\n',E'\n'))='839fe06f2da55e235a16a9b98d7bd4d7' AND prosecdef AND provolatile='s')
  OR to_regprocedure('private.stock_history_action_flag(text,text,jsonb,text)') IS NULL
  OR to_regprocedure('private.stock_history_immutable()') IS NULL
 THEN RAISE EXCEPTION 'PRODUCT_MERGE_DEPENDENCY_UNVERIFIED'; END IF;
END $dependencies$;

CREATE TABLE private.stock_history_product_merges(
 operation_id uuid PRIMARY KEY, branch_id text COLLATE "C" NOT NULL, terminal_id uuid NOT NULL,
 author_id uuid NOT NULL, master_id uuid NOT NULL, request_hash bytea NOT NULL CHECK(octet_length(request_hash)=32),
 capture_xid xid8 NOT NULL, outcome jsonb NOT NULL CHECK(jsonb_typeof(outcome)='object')
);
ALTER TABLE private.stock_history_product_merges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stock_history_product_merges FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER stock_history_product_merge_immutable BEFORE UPDATE OR DELETE ON private.stock_history_product_merges
 FOR EACH ROW EXECUTE FUNCTION private.stock_history_immutable();

CREATE FUNCTION private.stock_history_merge_stock_valid(p_stock jsonb,p_total integer) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path='' AS $stock$
BEGIN
 IF jsonb_typeof(p_stock)<>'object' OR octet_length(p_stock::text)>65536 THEN RETURN false; END IF;
 IF EXISTS(
  SELECT FROM jsonb_each(p_stock) AS e(key,value)
  WHERE length(key) NOT BETWEEN 1 AND 128 OR jsonb_typeof(value)<>'number' OR value::text!~'^-?(0|[1-9][0-9]{0,9})$'
 ) THEN RETURN false; END IF;
 RETURN (SELECT coalesce(sum(value::numeric),0)=p_total AND coalesce(bool_and(value::numeric BETWEEN -2147483648 AND 2147483647),true)
  FROM jsonb_each(p_stock));
END $stock$;
REVOKE ALL ON FUNCTION private.stock_history_merge_stock_valid(jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_merge_open_reference(p_product uuid) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $refs$
 SELECT CASE WHEN EXISTS(
  SELECT FROM public.bookings b WHERE b.status='active' AND (p_product IN(b.string_source_product_id,b.grip_product_id)
   OR EXISTS(SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.lines)='array' THEN b.lines ELSE '[]'::jsonb END) i
    WHERE lower(i->>'productId')=p_product::text)
   OR EXISTS(SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.charges)='array' THEN b.charges ELSE '[]'::jsonb END) i
    WHERE lower(i->>'productId')=p_product::text))) THEN 'PRODUCT_OPEN_BOOKING'
 WHEN EXISTS(SELECT FROM public.held_orders ticket WHERE COALESCE(ticket.status,'held') NOT IN ('completed','cancelled')
   AND EXISTS(SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ticket.lines)='array' THEN ticket.lines ELSE '[]'::jsonb END) i
    WHERE lower(i->>'productId')=p_product::text)) THEN 'PRODUCT_HELD_TICKET' ELSE NULL END;
$refs$;
REVOKE ALL ON FUNCTION private.stock_history_merge_open_reference(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_product_merge_actor(p_branch text,p_terminal uuid,p_author uuid) RETURNS public.app_users
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $scope$
DECLARE actor public.app_users%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_terminal IS NULL OR p_author IS NULL
   OR p_branch IS NULL OR length(p_branch) NOT BETWEEN 1 AND 128 OR p_branch<>btrim(p_branch)
 THEN RAISE EXCEPTION 'PRODUCT_MERGE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 LOCK TABLE public.stores,public.terminal_tokens IN SHARE MODE NOWAIT;
 IF NOT EXISTS(SELECT FROM public.stores s WHERE s.id=p_branch
   AND s.code~'^CODEX-STOCK401-MERGE-[A-Z0-9]{6,64}$' AND s.parent_id IS NULL AND s.private_catalogue IS TRUE
   AND s.is_active IS TRUE AND s.archived_at IS NULL AND s.group_id IS NOT NULL
   AND NOT EXISTS(SELECT FROM public.stores other WHERE other.id<>s.id AND (other.group_id=s.group_id OR other.parent_id=s.id)))
 THEN RAISE EXCEPTION 'PRODUCT_MERGE_WRITER_SCOPE_UNPROVEN' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.terminal_tokens WHERE id::text=p_terminal::text AND location_id=p_branch AND platform='pc'
  AND status IN('active','used') AND revoked_at IS NULL AND (is_claimed OR claimed_at IS NOT NULL)
  AND NOT COALESCE(management_sync_enabled,false) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_MERGE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM public.pos_sync_validate_scope('default',p_branch,p_terminal::text);
 SELECT * INTO actor FROM public.app_users WHERE id=p_author AND is_active FOR SHARE;
 IF NOT FOUND OR (actor.store_id IS NOT NULL AND actor.store_id<>p_branch)
  OR NOT private.stock_history_action_flag(actor.role::text,actor.role_slug,actor.permissions,'PRODUCT_MERGE')
  OR (actor.role::text IS DISTINCT FROM 'admin' AND actor.role_slug IS DISTINCT FROM 'admin'
       AND actor.permissions->'can_archive_product' IS DISTINCT FROM 'true'::jsonb)
 THEN RAISE EXCEPTION 'PRODUCT_MERGE_AUTHOR_DENIED' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $scope$;
REVOKE ALL ON FUNCTION private.stock_history_product_merge_actor(text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.stock_history_product_merge_require_writer_scope(p_branch text,p_terminal uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $scope$
BEGIN
 -- The caller holds both registration tables after checking the current actor.
 -- Retained registrations and terminal tombstones also count as possible writers.
 IF current_setting('transaction_isolation')<>'read committed'
  OR EXISTS(SELECT FROM public.terminal_tokens t WHERE t.location_id=p_branch AND t.id::text<>p_terminal::text)
  OR EXISTS(SELECT FROM public.sync_change_feed f WHERE f.branch_id=p_branch AND f.table_name='terminal_tokens'
    AND (f.entity_id::jsonb->>'id') IS DISTINCT FROM p_terminal::text)
 THEN RAISE EXCEPTION 'PRODUCT_MERGE_WRITER_SCOPE_UNPROVEN' USING ERRCODE='42501'; END IF;
END $scope$;
REVOKE ALL ON FUNCTION private.stock_history_product_merge_require_writer_scope(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_product_merge_capability(p_branch text,p_terminal uuid,p_author uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $capability$
BEGIN
 PERFORM private.stock_history_product_merge_actor(p_branch,p_terminal,p_author);
 PERFORM private.stock_history_product_merge_require_writer_scope(p_branch,p_terminal);
 RETURN true;
END $capability$;
REVOKE ALL ON FUNCTION public.pos_stock_history_product_merge_capability(text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_product_merge_capability(text,uuid,uuid) TO service_role;

CREATE FUNCTION private.stock_history_product_merge_request(
 p_operation uuid,p_branch text,p_terminal uuid,p_author uuid,p_master uuid,p_roster jsonb
) RETURNS TABLE(ordered jsonb,wanted uuid[],request_hash bytea,outcome jsonb)
LANGUAGE plpgsql SET search_path='' AS $request$
DECLARE prior private.stock_history_product_merges%ROWTYPE; size integer;
BEGIN
 IF p_operation IS NULL OR p_master IS NULL OR jsonb_typeof(p_roster) IS DISTINCT FROM 'array' OR octet_length(p_roster::text)>65536
 THEN RAISE EXCEPTION 'PRODUCT_MERGE_INVALID' USING ERRCODE='22023'; END IF;
 size:=jsonb_array_length(p_roster);
 IF size NOT BETWEEN 2 AND 50 OR EXISTS(SELECT FROM jsonb_array_elements(p_roster) AS e(row_value)
  WHERE jsonb_typeof(row_value)<>'object' OR NOT(row_value ?& ARRAY['id','sku','rowVersion'])
   OR row_value-ARRAY['id','sku','rowVersion']<>'{}'::jsonb
   OR jsonb_typeof(row_value->'sku') NOT IN('string','null') OR length(row_value->>'sku')>128
   OR (row_value->>'id'~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') IS NOT TRUE
   OR jsonb_typeof(row_value->'rowVersion') IS DISTINCT FROM 'string'
   OR (row_value->>'rowVersion'~'^[1-9][0-9]{0,9}$') IS NOT TRUE)
 THEN RAISE EXCEPTION 'PRODUCT_MERGE_INVALID' USING ERRCODE='22023'; END IF;
 SELECT array_agg(DISTINCT (r->>'id')::uuid ORDER BY (r->>'id')::uuid),jsonb_agg(r ORDER BY (r->>'id') COLLATE "C")
 INTO wanted,ordered FROM jsonb_array_elements(p_roster) r;
 IF cardinality(wanted)<>size OR NOT p_master=ANY(wanted) THEN RAISE EXCEPTION 'PRODUCT_MERGE_INVALID' USING ERRCODE='22023'; END IF;
 request_hash:=sha256(convert_to(jsonb_build_array(p_branch,p_terminal,p_author,p_master,ordered)::text,'UTF8'));
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-history-product-merge:'||p_operation::text,0));
 SELECT * INTO prior FROM private.stock_history_product_merges receipt WHERE receipt.operation_id=p_operation;
 IF FOUND THEN
  IF ROW(prior.branch_id,prior.terminal_id,prior.author_id,prior.master_id,prior.request_hash)
     IS DISTINCT FROM ROW(p_branch,p_terminal,p_author,p_master,request_hash)
  THEN RAISE EXCEPTION 'PRODUCT_MERGE_REPLAY_MISMATCH' USING ERRCODE='22023'; END IF;
  outcome:=prior.outcome;
 END IF;
 RETURN NEXT;
END $request$;
REVOKE ALL ON FUNCTION private.stock_history_product_merge_request(uuid,text,uuid,uuid,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.pos_stock_history_product_merge_receipt(
 p_operation uuid,p_branch text,p_terminal uuid,p_author uuid,p_master uuid,p_roster jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $receipt$
DECLARE accepted jsonb;
BEGIN
 PERFORM private.stock_history_product_merge_actor(p_branch,p_terminal,p_author);
 SELECT request.outcome INTO STRICT accepted
 FROM private.stock_history_product_merge_request(p_operation,p_branch,p_terminal,p_author,p_master,p_roster) request;
 -- After the operation lock, a new statement snapshot is required to confirm absence.
 IF accepted IS NULL THEN
  IF current_setting('transaction_isolation')<>'read committed' THEN
   RAISE EXCEPTION 'PRODUCT_MERGE_RECEIPT_UNVERIFIED' USING ERRCODE='40001';
  END IF;
  PERFORM private.stock_history_product_merge_require_writer_scope(p_branch,p_terminal);
 END IF;
 RETURN jsonb_build_object('ok',true,'receipt',accepted);
END $receipt$;
REVOKE ALL ON FUNCTION public.pos_stock_history_product_merge_receipt(uuid,text,uuid,uuid,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_product_merge_receipt(uuid,text,uuid,uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.pos_stock_history_merge_products(
 p_operation uuid,p_branch text,p_terminal uuid,p_author uuid,p_master uuid,p_roster jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $merge$
DECLARE actor public.app_users%ROWTYPE; prior jsonb;
 winner public.products%ROWTYPE; loser public.products%ROWTYPE; retired public.products%ROWTYPE; saved public.products%ROWTYPE;
 request_hash bytea; ordered jsonb; wanted uuid[]; allowed uuid[];
 stock jsonb; transferred bigint:=0; winner_qty bigint; winner_total bigint; reason text;
 codes text[]; aliases text[]; blocked jsonb:='[]'; removed jsonb:='[]'; response jsonb;
 is_admin boolean; has_stock_leg boolean:=false; loser_quantity bigint;
BEGIN
 actor:=private.stock_history_product_merge_actor(p_branch,p_terminal,p_author);
 is_admin:=actor.role::text IS NOT DISTINCT FROM 'admin' OR actor.role_slug IS NOT DISTINCT FROM 'admin';
 SELECT request.ordered,request.wanted,request.request_hash,request.outcome INTO STRICT ordered,wanted,request_hash,prior
 FROM private.stock_history_product_merge_request(p_operation,p_branch,p_terminal,p_author,p_master,p_roster) request;
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 PERFORM private.stock_history_product_merge_require_writer_scope(p_branch,p_terminal);

 -- These existing document links are JSON, so they do not participate in the
 -- product FK row lock. Yield immediately to a concurrent document writer.
 LOCK TABLE public.bookings,public.held_orders IN SHARE MODE NOWAIT;
 SELECT array_agg(locked.id ORDER BY locked.id) INTO allowed FROM (
  SELECT p.id FROM public.products p WHERE p.id=ANY(wanted) AND p.owner_store_id=p_branch ORDER BY p.id FOR UPDATE NOWAIT
 ) locked;
 IF allowed IS DISTINCT FROM wanted THEN RAISE EXCEPTION 'PRODUCT_MERGE_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(ordered) proposed JOIN public.products p ON p.id=(proposed->>'id')::uuid
   WHERE ROW(p.sku,p.row_version::text) IS DISTINCT FROM ROW(proposed->>'sku',proposed->>'rowVersion'))
 THEN RAISE EXCEPTION 'PRODUCT_MERGE_ROSTER_CHANGED' USING ERRCODE='40001'; END IF;
 SELECT * INTO STRICT winner FROM public.products WHERE id=p_master;
 IF winner.deleted_at IS NOT NULL OR private.stock_history_merge_stock_valid(winner.stock_by_store,winner.stock_quantity) IS NOT TRUE
 THEN RAISE EXCEPTION 'PRODUCT_MERGE_MASTER_UNVERIFIED'; END IF;
 IF private.stock_history_merge_open_reference(p_master) IS NOT NULL THEN RAISE EXCEPTION 'PRODUCT_MERGE_MASTER_IN_USE'; END IF;
 aliases:=coalesce(winner.barcode_aliases,ARRAY[]::text[]);

 FOR loser IN SELECT * FROM public.products WHERE id=ANY(wanted) AND id<>p_master ORDER BY id LOOP
  SELECT CASE WHEN verdict->'exists' IS DISTINCT FROM 'true'::jsonb THEN 'PRODUCT_DELETE_UNVERIFIED'
   WHEN verdict->'sales'='true'::jsonb THEN 'PRODUCT_HAS_SALES_HISTORY'
   WHEN verdict->'purchases'='true'::jsonb THEN 'PRODUCT_HAS_PURCHASES'
   WHEN verdict->'transfers'='true'::jsonb THEN 'PRODUCT_HAS_TRANSFERS'
   WHEN verdict->'adjustments'='true'::jsonb THEN 'PRODUCT_HAS_ADJUSTMENTS'
   WHEN verdict->'promotions'='true'::jsonb THEN 'PRODUCT_HAS_PROMOTIONS'
   WHEN EXISTS(SELECT FROM public.item_activity_logs WHERE product_id=loser.id) THEN 'PRODUCT_HAS_ACTIVITY_HISTORY'
   WHEN EXISTS(SELECT FROM public.product_barcodes WHERE product_id=loser.id) THEN 'PRODUCT_HAS_STRUCTURED_BARCODES'
   WHEN loser.deleted_at IS NOT NULL OR private.stock_history_merge_stock_valid(loser.stock_by_store,loser.stock_quantity) IS NOT TRUE
    THEN 'PRODUCT_STOCK_UNVERIFIED'
   WHEN EXISTS(SELECT FROM jsonb_each_text(loser.stock_by_store) e WHERE key<>p_branch AND value::integer<>0)
    THEN 'PRODUCT_OTHER_BRANCH_STOCK'
   ELSE private.stock_history_merge_open_reference(loser.id) END INTO reason
  FROM public.product_delete_guard(loser.id) verdict;
  codes:=ARRAY(SELECT DISTINCT code FROM unnest(ARRAY[loser.barcode,loser.sku]||COALESCE(loser.barcode_aliases,ARRAY[]::text[])) code
    WHERE nullif(btrim(code),'') IS NOT NULL AND code IS DISTINCT FROM winner.barcode AND code IS DISTINCT FROM winner.sku ORDER BY code);
  -- Preserve the scan identity of every retained catalogue record. Ambiguous
  -- spellings remain for explicit review, even on a requested duplicate.
  IF reason IS NULL AND (EXISTS(SELECT FROM public.products p WHERE p.id NOT IN (p_master,loser.id) AND p.deleted_at IS NULL
    AND (p.barcode=ANY(codes) OR p.sku=ANY(codes) OR p.barcode_aliases&&codes))
    OR EXISTS(SELECT FROM public.product_barcodes b WHERE b.product_id<>p_master AND b.barcode=ANY(codes)))
  THEN reason:='PRODUCT_ALIAS_IN_USE'; END IF;
  IF reason IS NULL THEN
   BEGIN
    DELETE FROM public.products WHERE id=loser.id AND owner_store_id=p_branch RETURNING * INTO retired;
    IF NOT FOUND THEN reason:='PRODUCT_DELETE_UNVERIFIED'; END IF;
   EXCEPTION WHEN foreign_key_violation THEN reason:='PRODUCT_LINKED_RECORD';
   END;
  END IF;
  IF reason IS NOT NULL THEN
   blocked:=blocked||jsonb_build_array(jsonb_build_object('id',loser.id,'name',loser.name,'code',reason));
  ELSE
   loser_quantity:=coalesce((retired.stock_by_store->>p_branch)::bigint,0);
   transferred:=transferred+loser_quantity;
   has_stock_leg:=has_stock_leg OR loser_quantity<>0;
   aliases:=aliases||codes;
   removed:=removed||jsonb_build_array(jsonb_build_object('id',retired.id,'sku',retired.sku,'name',retired.name,
    'quantity',coalesce(retired.stock_by_store->>p_branch,'0'),'barcode',retired.barcode,'aliases',to_jsonb(retired.barcode_aliases)));
  END IF;
 END LOOP;

 winner_qty:=coalesce((winner.stock_by_store->>p_branch)::bigint,0)+transferred;
 winner_total:=winner.stock_quantity::bigint+transferred;
 IF winner_qty NOT BETWEEN -2147483648 AND 2147483647 OR winner_total NOT BETWEEN -2147483648 AND 2147483647
 THEN RAISE EXCEPTION 'PRODUCT_MERGE_STOCK_OVERFLOW'; END IF;
 IF jsonb_array_length(removed)>0 THEN
  stock:=CASE WHEN transferred=0 THEN winner.stock_by_store ELSE jsonb_set(winner.stock_by_store,ARRAY[p_branch],to_jsonb(winner_qty::integer),true) END;
  aliases:=ARRAY(SELECT DISTINCT code FROM unnest(aliases) code ORDER BY code);
  IF NOT is_admin AND has_stock_leg AND actor.permissions->'can_adjust_stock' IS DISTINCT FROM 'true'::jsonb
   THEN RAISE EXCEPTION 'PRODUCT_MERGE_AUTHOR_DENIED' USING ERRCODE='42501'; END IF;
  IF aliases @> COALESCE(winner.barcode_aliases,ARRAY[]::text[]) AND aliases <@ COALESCE(winner.barcode_aliases,ARRAY[]::text[]) THEN
   aliases:=winner.barcode_aliases;
  ELSIF NOT is_admin AND actor.permissions->'can_link_product_barcode' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'PRODUCT_MERGE_AUTHOR_DENIED' USING ERRCODE='42501';
  END IF;
  IF cardinality(aliases)>2000 OR octet_length(to_jsonb(aliases)::text)>65536
  THEN RAISE EXCEPTION 'PRODUCT_MERGE_ALIASES_TOO_LARGE'; END IF;
  UPDATE public.products SET stock_by_store=stock,stock_quantity=winner_total::integer,barcode_aliases=aliases,row_version=row_version+1
   WHERE id=p_master AND owner_store_id=p_branch RETURNING * INTO saved;
  IF NOT FOUND OR ROW(saved.owner_store_id,saved.sku,saved.barcode,saved.stock_by_store,saved.stock_quantity,saved.barcode_aliases,saved.row_version)
   IS DISTINCT FROM ROW(winner.owner_store_id,winner.sku,winner.barcode,stock,winner_total::integer,aliases,winner.row_version+1)
  THEN RAISE EXCEPTION 'PRODUCT_MERGE_CONSERVATION_UNPROVEN'; END IF;
 ELSE saved:=winner; END IF;
 response:=jsonb_build_object('ok',true,'operationId',p_operation,'branchId',p_branch,'removed',removed,'held',blocked,
  'master',jsonb_build_object('id',saved.id,'sku',saved.sku,'quantity',winner_qty::text,'stockTotal',winner_total::text,
   'rowVersion',saved.row_version::text,'aliases',to_jsonb(saved.barcode_aliases)));
 INSERT INTO private.stock_history_product_merges VALUES(p_operation,p_branch,p_terminal,p_author,p_master,request_hash,pg_current_xact_id(),response);
 RETURN response;
END $merge$;
REVOKE ALL ON FUNCTION public.pos_stock_history_merge_products(uuid,text,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.pos_stock_history_merge_products(uuid,text,uuid,uuid,uuid,jsonb) TO service_role;

COMMIT;
