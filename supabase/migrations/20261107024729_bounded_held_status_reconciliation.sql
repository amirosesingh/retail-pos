-- Read-only bounded Operations ticket reconciliation. No business record or existing grant is changed.
-- Exact target/file approval is required before live application.
-- BOUNDED_HELD_STATUS_BEGIN
DO $held_status_upgrade$
DECLARE
 expected constant jsonb := $held_metadata$[{"acl":"{postgres=X/postgres,service_role=X/postgres}","cost":100,"rows":0,"owner":"postgres","config":["search_path=pg_catalog"],"strict":true,"definer":false,"returns":"jsonb","support":"-","language":"plpgsql","parallel":"u","leakproof":false,"signature":"pos_sync_history_project_v1(jsonb,text,boolean)","definition":"\u0043REATE OR REPLACE FUNCTION public.pos_sync_history_project_v1(p_value jsonb, p_table text DEFAULT ''::text, p_keep_commerce boolean DEFAULT false)\n RETURNS jsonb\n LANGUAGE plpgsql\n IMMUTABLE STRICT\n SET search_path TO 'pg_catalog'\nAS $function$\nDECLARE\n  v_row jsonb := p_value;\n  v_context text := p_table;\n  v_result jsonb := '{}'::jsonb;\n  v_price jsonb;\n  v_remove text[];\n  v_number double precision;\nBEGIN\n  -- The former Worker parsed JSON numbers before serializing the response.\n  -- JSON.stringify maps non-finite JavaScript numbers to null. Preserve that\n  -- transport behavior for valid PostgreSQL numeric values beyond float8.\n  IF pg_catalog.jsonb_typeof(p_value) = 'number' AND pg_catalog.abs((p_value::text)::numeric) > 1 THEN\n    BEGIN\n      v_number := (p_value::text)::double precision;\n    EXCEPTION WHEN numeric_value_out_of_range THEN RETURN 'null'::jsonb;\n    END;\n  END IF;\n  IF pg_catalog.jsonb_typeof(p_value) = 'array' THEN\n    IF NOT pg_catalog.jsonb_path_exists(p_value,'strict $[*] ? (@.type() == \"object\" || @.type() == \"array\" || (@.type() == \"number\" && (@ > 1e308 || @ < -1e308)))') THEN\n      RETURN p_value;\n    END IF;\n    SELECT COALESCE(pg_catalog.jsonb_agg(CASE pg_catalog.jsonb_typeof(a.value)\n      WHEN 'object' THEN public.pos_sync_history_project_v1(a.value,p_table,p_keep_commerce)\n      WHEN 'array' THEN public.pos_sync_history_project_v1(a.value,p_table,p_keep_commerce)\n      WHEN 'number' THEN CASE WHEN a.value>'1e308'::jsonb OR a.value<'-1e308'::jsonb\n        THEN public.pos_sync_history_project_v1(a.value,p_table,p_keep_commerce) ELSE a.value END\n      ELSE a.value END ORDER BY a.ordinality),'[]'::jsonb)\n      INTO v_result FROM pg_catalog.jsonb_array_elements(p_value) WITH ORDINALITY AS a(value,ordinality);\n    RETURN v_result;\n  END IF;\n  IF pg_catalog.jsonb_typeof(p_value) <> 'object' THEN RETURN p_value; END IF;\n  IF NOT p_keep_commerce\n     AND (p_table = 'settings_scoped' OR v_row->>'table_name' = 'settings_scoped')\n     AND pg_catalog.jsonb_typeof(v_row->'key') = 'string'\n     AND pg_catalog.left(v_row->>'key',14) = 'product_price:'\n     AND pg_catalog.jsonb_typeof(v_row->'value') IN ('object','array') THEN\n    IF pg_catalog.jsonb_typeof(v_row->'value') = 'array' THEN\n      SELECT COALESCE(pg_catalog.jsonb_object_agg((a.ordinality-1)::text,a.value),'{}'::jsonb)\n        INTO v_price FROM pg_catalog.jsonb_array_elements(v_row->'value') WITH ORDINALITY AS a(value,ordinality);\n    ELSE v_price := (v_row->'value') - 'ecom_price'; END IF;\n    v_row := pg_catalog.jsonb_set(v_row,ARRAY['value'],v_price,false);\n  END IF;\n  IF pg_catalog.jsonb_typeof(v_row->'table_name') = 'string' THEN v_context := v_row->>'table_name'; END IF;\n  v_remove:=CASE WHEN v_context='terminal_tokens' THEN ARRAY['claim_secret_hash','claim_proof','claimed_proof_hash']::text[] ELSE ARRAY[]::text[] END;\n  IF NOT p_keep_commerce THEN\n    v_remove:=v_remove||ARRAY['ecommerceEnabled']::text[];\n    IF v_context='products' THEN v_remove:=v_remove||ARRAY['ecom_price','ecom_visible','ecom_enabled','is_published']::text[]; END IF;\n  END IF;\n  -- Reuse untouched maps, including their large enclosing images. Materialize\n  -- projections once and aggregate only changed children, never every key.\n  IF pg_catalog.jsonb_path_exists(v_row,'strict $.* ? (@.type() == \"object\" || @.type() == \"array\" || (@.type() == \"number\" && (@ > 1e308 || @ < -1e308)))') THEN\n    WITH children AS MATERIALIZED (\n      SELECT e.key,e.value FROM pg_catalog.jsonb_each(v_row) AS e\n      WHERE NOT(e.key=ANY(v_remove)) AND CASE pg_catalog.jsonb_typeof(e.value)\n        WHEN 'object' THEN true WHEN 'array' THEN true\n        WHEN 'number' THEN e.value>'1e308'::jsonb OR e.value<'-1e308'::jsonb ELSE false END\n    ), projected AS MATERIALIZED (\n      SELECT key,value,public.pos_sync_history_project_v1(value,v_context,p_keep_commerce) AS next_value FROM children\n    ) SELECT pg_catalog.jsonb_object_agg(key,next_value) INTO v_result FROM projected WHERE next_value IS DISTINCT FROM value;\n    IF v_result IS NOT NULL THEN v_row:=v_row||v_result; END IF;\n  END IF;\n  IF NOT v_row ?| v_remove THEN RETURN v_row; END IF;\n  v_result:=v_row-v_remove;\n  RETURN v_result;\nEND;\n$function$\n","volatility":"i","definition_md5":"4633e04e150c350518938f2ba661fca1","acl_values":["postgres=X/postgres","service_role=X/postgres"]},{"acl":"{postgres=X/postgres,service_role=X/postgres}","cost":100,"rows":0,"owner":"postgres","config":["search_path=public, pg_temp"],"strict":false,"definer":true,"returns":"void","support":"-","language":"plpgsql","parallel":"u","leakproof":false,"signature":"pos_sync_validate_scope(text,text,text)","definition":"\u0043REATE OR REPLACE FUNCTION public.pos_sync_validate_scope(p_organization_id text, p_branch_id text, p_terminal_id text)\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS $function$\r\nBEGIN\r\n IF p_organization_id IS DISTINCT FROM 'default' THEN RAISE EXCEPTION 'SYNC_ORGANIZATION_FORBIDDEN'; END IF;\r\n IF NULLIF(btrim(p_branch_id),'') IS NULL OR NULLIF(btrim(p_terminal_id),'') IS NULL THEN RAISE EXCEPTION 'SYNC_TERMINAL_REQUIRED'; END IF;\r\n IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens t WHERE t.id::text=p_terminal_id AND t.location_id=p_branch_id AND t.status IN ('active','used') AND t.revoked_at IS NULL) THEN RAISE EXCEPTION 'SYNC_TERMINAL_SCOPE_FORBIDDEN'; END IF;\r\nEND $function$\n","volatility":"v","definition_md5":"987c6972d40518c2431cad4711bcd11b","acl_values":["postgres=X/postgres","service_role=X/postgres"]}]$held_metadata$::jsonb;
 required_columns constant jsonb := $held_metadata$[{"type":"uuid","not_null":true,"table_name":"bookings","column_name":"id"},{"type":"text","not_null":false,"table_name":"bookings","column_name":"store_id"},{"type":"text","not_null":false,"table_name":"bookings","column_name":"shift_id"},{"type":"text","not_null":true,"table_name":"held_orders","column_name":"id"},{"type":"text","not_null":false,"table_name":"held_orders","column_name":"store_id"},{"type":"text","not_null":false,"table_name":"held_orders","column_name":"shift_id"},{"type":"numeric","not_null":true,"table_name":"held_orders","column_name":"total"},{"type":"jsonb","not_null":true,"table_name":"held_orders","column_name":"lines"},{"type":"numeric","not_null":true,"table_name":"held_orders","column_name":"cart_discount"},{"type":"text","not_null":true,"table_name":"held_orders","column_name":"cart_discount_type"},{"type":"text","not_null":false,"table_name":"held_orders","column_name":"exchange_ref"},{"type":"text","not_null":false,"table_name":"held_orders","column_name":"member_id"},{"type":"jsonb","not_null":false,"table_name":"held_orders","column_name":"coupon"},{"type":"text","not_null":true,"table_name":"held_orders","column_name":"note"},{"type":"timestamp with time zone","not_null":true,"table_name":"held_orders","column_name":"updated_at"},{"type":"text","not_null":false,"table_name":"held_orders","column_name":"bill_no"},{"type":"integer","not_null":true,"table_name":"held_orders","column_name":"row_version"},{"type":"text","not_null":true,"table_name":"held_orders","column_name":"status"},{"type":"uuid","not_null":false,"table_name":"held_orders","column_name":"pending_request_id"},{"type":"text","not_null":false,"table_name":"held_orders","column_name":"approval_snapshot_hash"},{"type":"uuid","not_null":true,"table_name":"sales","column_name":"id"},{"type":"text","not_null":true,"table_name":"sales","column_name":"bill_number"},{"type":"text","not_null":false,"table_name":"sales","column_name":"store_id"},{"type":"text","not_null":false,"table_name":"sales","column_name":"shift_id"}]$held_metadata$::jsonb;
 ddl constant text := $held_status_definition$-- A bounded, read-only proof. It neither completes a sale nor changes a ticket.
CREATE OR REPLACE FUNCTION public.pos_sync_held_status_v1(
 p_organization_id text,p_branch_id text,p_terminal_id text,p_tickets jsonb,
 p_keep_commerce boolean DEFAULT false,p_max_bytes integer DEFAULT 2097152
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $held_status$
DECLARE
 v_ticket jsonb; v_held public.held_orders%ROWTYPE; v_parents jsonb; v_parent jsonb;
 v_projected jsonb; v_identity jsonb; v_lines jsonb; v_line jsonb; v_clean jsonb; v_coupon jsonb;
 v_key text; v_value jsonb; v_record jsonb; v_records jsonb:='[]'::jsonb; v_result jsonb;
 v_invalid boolean; v_status text; v_proof text; v_version text; v_updated text;
BEGIN
 -- This validator admits Operations only. The outer relay separately verifies
 -- the existing device-binding proof; a Management replica is not a writer.
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 IF p_tickets IS NULL OR jsonb_typeof(p_tickets)<>'array' OR jsonb_array_length(p_tickets)<1 OR jsonb_array_length(p_tickets)>100
 OR p_keep_commerce IS NULL OR p_max_bytes IS NULL OR p_max_bytes<1024 OR p_max_bytes>2097152
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='HELD_STATUS_INVALID_ARGUMENT'; END IF;
 FOR v_ticket IN SELECT value FROM jsonb_array_elements(p_tickets) LOOP
  IF jsonb_typeof(v_ticket)<>'object' THEN RAISE EXCEPTION 'HELD_STATUS_INVALID_TICKET'; END IF;
  IF NOT(v_ticket ?& ARRAY['id','billNo','shiftId']) OR v_ticket-'id'-'billNo'-'shiftId'<>'{}'::jsonb
  OR jsonb_typeof(v_ticket->'id')<>'string' OR length(v_ticket->>'id') NOT BETWEEN 1 AND 450
  OR jsonb_typeof(v_ticket->'billNo') NOT IN ('string','null') OR length(v_ticket->>'billNo')>450
  OR jsonb_typeof(v_ticket->'shiftId') NOT IN ('string','null') OR length(v_ticket->>'shiftId')>450
  THEN RAISE EXCEPTION 'HELD_STATUS_INVALID_TICKET'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT (value->>'id') COLLATE "C") FROM jsonb_array_elements(p_tickets))<>jsonb_array_length(p_tickets)
 THEN RAISE EXCEPTION 'HELD_STATUS_DUPLICATE_TICKET'; END IF;
 FOR v_ticket IN SELECT value FROM jsonb_array_elements(p_tickets) LOOP
  v_parent:=NULL;v_identity:=NULL;v_version:=NULL;v_updated:=NULL;
  SELECT * INTO v_held FROM public.held_orders h
   WHERE h.id=v_ticket->>'id' AND h.id COLLATE "C"=(v_ticket->>'id') COLLATE "C"
    AND h.store_id COLLATE "C"=p_branch_id COLLATE "C";
  IF FOUND THEN
   IF v_held.status IS NULL OR v_held.status NOT IN ('completed','cancelled') THEN CONTINUE; END IF;
   IF v_held.row_version IS NULL OR v_held.row_version<1 OR v_held.updated_at IS NULL OR NOT isfinite(v_held.updated_at)
    OR v_held.updated_at<'0001-01-01Z'::timestamptz OR v_held.updated_at>'9999-12-31T23:59:59.999999Z'::timestamptz THEN CONTINUE; END IF;
   v_status:=v_held.status;v_proof:='held';v_version:=v_held.row_version::text;
   v_updated:=to_char(v_held.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')||'0Z';
   -- Existing privacy projection first, then a narrow business-identity allowlist.
   -- Labels, names, notes, costs, reasons and unknown/nested private fields are
   -- not an opaque side channel around normal sync privacy.
   v_projected:=public.pos_sync_history_project_v1(jsonb_build_object(
    'id',v_held.id,'store_id',v_held.store_id,'bill_no',v_held.bill_no,'shift_id',v_held.shift_id,
    'total',v_held.total,'cart_discount',v_held.cart_discount,'cart_discount_type',v_held.cart_discount_type,
    'exchange_ref',v_held.exchange_ref,'member_id',v_held.member_id,'coupon',v_held.coupon,'lines',v_held.lines,
    'pending_request_id',v_held.pending_request_id,'approval_snapshot_hash',v_held.approval_snapshot_hash),'held_orders',p_keep_commerce);
   v_identity:='{}'::jsonb;v_invalid:=false;
   FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_projected) LOOP
    IF v_key IN ('coupon','lines') THEN CONTINUE; END IF;
    IF jsonb_typeof(v_value) NOT IN ('string','number','boolean','null') THEN v_invalid:=true;EXIT;END IF;
    v_identity:=v_identity||jsonb_build_object(v_key,v_value);
   END LOOP;
   IF v_invalid OR jsonb_typeof(v_projected->'lines') IS DISTINCT FROM 'array' THEN CONTINUE;END IF;
   v_lines:='[]'::jsonb;
   FOR v_line IN SELECT value FROM jsonb_array_elements(v_projected->'lines') LOOP
    IF jsonb_typeof(v_line)<>'object' THEN v_invalid:=true;EXIT;END IF;
    v_clean:='{}'::jsonb;
    FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_line) WHERE key=ANY(ARRAY[
     'saleItemId','productId','variantCode','price','originalPrice','priceOverridden','qty','taxRate','discount','discountType',
     'credit','foc','promoId','couponCode','couponDiscount','bookingId','bookingRef']) LOOP
     IF jsonb_typeof(v_value) NOT IN ('string','number','boolean','null') THEN v_invalid:=true;EXIT;END IF;
     v_clean:=v_clean||jsonb_build_object(v_key,v_value);
    END LOOP;
    IF v_invalid THEN EXIT;END IF;
    v_lines:=v_lines||jsonb_build_array(v_clean);
   END LOOP;
   IF v_invalid THEN CONTINUE;END IF;
   v_coupon:=v_projected->'coupon';
   IF jsonb_typeof(v_coupon)='object' THEN
    v_clean:='{}'::jsonb;
    FOR v_key,v_value IN SELECT key,value FROM jsonb_each(v_coupon) WHERE key=ANY(ARRAY['code','promoId','scope','discount','productId']) LOOP
     IF jsonb_typeof(v_value) NOT IN ('string','number','boolean','null') THEN v_invalid:=true;EXIT;END IF;
     v_clean:=v_clean||jsonb_build_object(v_key,v_value);
    END LOOP;
    v_coupon:=v_clean;
   ELSIF jsonb_typeof(v_coupon) IS DISTINCT FROM 'null' THEN v_invalid:=true;END IF;
   IF v_invalid THEN CONTINUE;END IF;
   v_identity:=v_identity||jsonb_build_object('lines',v_lines,'coupon',v_coupon);
   IF v_status='completed' THEN
    SELECT COALESCE(jsonb_agg(parent),'[]'::jsonb) INTO v_parents FROM (
     SELECT jsonb_build_object('kind','sale','id',s.id::text,'storeId',s.store_id,'billNo',s.bill_number,'shiftId',s.shift_id) parent
      FROM public.sales s WHERE s.store_id COLLATE "C"=p_branch_id COLLATE "C" AND NULLIF(v_held.bill_no,'') IS NOT NULL
      AND s.bill_number=v_held.bill_no AND s.bill_number COLLATE "C"=v_held.bill_no COLLATE "C"
     UNION ALL
     SELECT jsonb_build_object('kind','booking','id',b.id::text,'storeId',b.store_id,'billNo',NULL,'shiftId',b.shift_id)
      FROM public.bookings b WHERE b.id=CASE WHEN v_held.note ~ '^booking:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN right(v_held.note,36)::uuid ELSE NULL END
      AND b.store_id COLLATE "C"=p_branch_id COLLATE "C"
      AND v_held.note COLLATE "C"=('booking:'||b.id::text) COLLATE "C" AND b.shift_id IS NOT DISTINCT FROM v_held.shift_id
     LIMIT 2
    ) matched;
    IF jsonb_array_length(v_parents)<>1 THEN CONTINUE;END IF;v_parent:=v_parents->0;
   END IF;
  ELSE
   -- Absence never means cancelled or uploaded. A matching accepted parent is
   -- a different proof, whose original local receipt/CT checks remain in Main.
   IF NULLIF(v_ticket->>'billNo','') IS NULL THEN CONTINUE;END IF;
   SELECT COALESCE(jsonb_agg(parent),'[]'::jsonb) INTO v_parents FROM (
    SELECT jsonb_build_object('kind','sale','id',s.id::text,'storeId',s.store_id,'billNo',s.bill_number,'shiftId',s.shift_id) parent
     FROM public.sales s WHERE s.store_id COLLATE "C"=p_branch_id COLLATE "C"
     AND s.bill_number=v_ticket->>'billNo' AND s.bill_number COLLATE "C"=(v_ticket->>'billNo') COLLATE "C"
     AND (v_ticket->'shiftId'='null'::jsonb OR s.shift_id IS NOT DISTINCT FROM v_ticket->>'shiftId')
     LIMIT 2
   ) matched;
   IF jsonb_array_length(v_parents)<>1 THEN CONTINUE;END IF;
   v_parent:=v_parents->0;v_status:='completed';v_proof:='accepted_parent';
  END IF;
  v_record:=jsonb_build_object('id',v_ticket->>'id','status',v_status,'proofFrom',v_proof,
   'rowVersion',v_version,'updatedAt',v_updated,'identityJson',CASE WHEN v_identity IS NULL THEN NULL ELSE v_identity::text END,'parent',v_parent);
  v_records:=v_records||jsonb_build_array(v_record);
 END LOOP;
 v_result:=jsonb_build_object('ok',true,'heldStatusVersion',1,'organizationId',p_organization_id,'branchId',p_branch_id,'terminalId',p_terminal_id,'records',v_records);
 IF octet_length(v_result::text)>p_max_bytes THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='HELD_STATUS_TOO_LARGE';END IF;
 PERFORM set_config('response.headers',jsonb_build_array(
  jsonb_build_object('X-POS-Held-Status-Version','1'),
  jsonb_build_object('X-POS-Held-Status-Bytes',octet_length(v_result::text)::text),
  jsonb_build_object('X-POS-Held-Status-Rows',jsonb_array_length(v_records)::text))::text,true);
 RETURN v_result;
END;
$held_status$;
$held_status_definition$;
 entry jsonb;fn oid;name text;actual text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'HELD_STATUS_MIGRATION_OWNER';END IF;
 PERFORM set_config('search_path','pg_catalog,public',true);
 FOREACH name IN ARRAY ARRAY['held_orders','sales','bookings'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=name AND c.relkind='r' AND c.relrowsecurity AND pg_get_userbyid(c.relowner)='postgres')
   THEN RAISE EXCEPTION 'HELD_STATUS_TABLE_UNSUPPORTED';END IF;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(required_columns) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||(entry->>'table_name'))
   AND a.attname=entry->>'column_name' AND a.attnum>0 AND NOT a.attisdropped AND format_type(a.atttypid,a.atttypmod)=entry->>'type' AND a.attnotnull=(entry->>'not_null')::boolean)
   THEN RAISE EXCEPTION 'HELD_STATUS_COLUMN_UNSUPPORTED';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid='public.held_orders'::regclass AND i.indisprimary AND i.indisvalid AND i.indisready
  AND i.indnkeyatts=1 AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='id'))
 OR NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid='public.bookings'::regclass AND i.indisprimary AND i.indisvalid AND i.indisready
  AND i.indnkeyatts=1 AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='id'))
 OR NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am a ON a.oid=c.relam WHERE i.indrelid='public.sales'::regclass
  AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND a.amname='btree' AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='bill_number'))
 THEN RAISE EXCEPTION 'HELD_STATUS_LOOKUP_INDEX_UNSUPPORTED';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(expected) LOOP
  fn:=to_regprocedure('public.'||(entry->>'signature'));
  IF fn IS NULL OR md5(replace(pg_get_functiondef(fn),chr(13)||chr(10),chr(10)))<>entry->>'definition_md5'
   OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=fn
    AND pg_get_userbyid(p.proowner)=entry->>'owner' AND (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl)v)=entry->'acl_values'
    AND to_jsonb(p.proconfig)=entry->'config' AND p.prosecdef=(entry->>'definer')::boolean AND p.proisstrict=(entry->>'strict')::boolean
    AND p.provolatile::text=entry->>'volatility' AND l.lanname=entry->>'language' AND pg_get_function_result(p.oid)=entry->>'returns'
    AND p.prokind='f' AND NOT p.proleakproof AND p.prosupport=0 AND p.proparallel='u' AND p.procost=100 AND p.prorows=0)
   THEN RAISE EXCEPTION 'HELD_STATUS_SOURCE_UNSUPPORTED';END IF;
 END LOOP;
 fn:=to_regprocedure('public.pos_sync_held_status_v1(text,text,text,jsonb,boolean,integer)');
 IF fn IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn
  AND replace(p.prosrc,chr(13)||chr(10),chr(10))=split_part(replace(ddl,chr(13)||chr(10),chr(10)),'$held_status$',2) AND pg_get_userbyid(p.proowner)='postgres'
  AND NOT p.prosecdef AND NOT p.proisstrict AND p.provolatile='s' AND p.prorettype='jsonb'::regtype AND p.prokind='f'
  AND NOT p.proleakproof AND p.prosupport=0 AND p.proparallel='u' AND p.procost=100 AND p.prorows=0
  AND p.proconfig=ARRAY['search_path=pg_catalog, public']
  AND (SELECT jsonb_agg(v::text ORDER BY v::text) FROM unnest(p.proacl)v)=jsonb_build_array('postgres=X/postgres','service_role=X/postgres'))
 THEN RAISE EXCEPTION 'HELD_STATUS_EXISTING_CHANGED';END IF;
 EXECUTE replace(ddl,chr(13)||chr(10),chr(10));
 REVOKE ALL ON FUNCTION public.pos_sync_held_status_v1(text,text,text,jsonb,boolean,integer) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.pos_sync_held_status_v1(text,text,text,jsonb,boolean,integer) TO service_role;
 SELECT prosrc INTO actual FROM pg_proc WHERE oid=to_regprocedure('public.pos_sync_held_status_v1(text,text,text,jsonb,boolean,integer)');
 IF actual IS DISTINCT FROM split_part(replace(ddl,chr(13)||chr(10),chr(10)),'$held_status$',2) THEN RAISE EXCEPTION 'HELD_STATUS_READBACK';END IF;
END;
$held_status_upgrade$;
-- BOUNDED_HELD_STATUS_END
