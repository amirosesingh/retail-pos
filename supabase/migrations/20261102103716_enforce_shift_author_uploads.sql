-- AUTH-37 source and isolated-test preparation only. Expected amounts retain
-- their existing consistency-only contract; this does not prove Main key origin.
BEGIN;
DO $prerequisite$ BEGIN
 IF to_regclass('pos_sync_private.shift_author_keys') IS NULL OR
    to_regclass('pos_sync_private.shift_intent_receipts') IS NULL OR
    to_regprocedure('public.pos_sync_push_shift_intent(uuid,text,text,text,jsonb,jsonb)') IS NULL OR
    position('public."shifts"."closed_at" IS NOT NULL' IN pg_get_functiondef('public.sync_apply_shifts(jsonb)'::regprocedure))=0
 THEN RAISE EXCEPTION 'AUTH37_REQUIRES_REVIEWED_AUTHOR_AND_CAUSAL_FOUNDATIONS'; END IF;
END $prerequisite$;

CREATE TABLE pos_sync_private.shift_author_receipts (
 intent_id uuid PRIMARY KEY REFERENCES pos_sync_private.shift_intent_receipts(intent_id) ON DELETE RESTRICT,
 shift_id uuid NOT NULL, terminal_id text NOT NULL, branch_id text NOT NULL,
 key_id uuid NOT NULL REFERENCES pos_sync_private.shift_author_keys(key_id) ON DELETE RESTRICT,
 author_id uuid NOT NULL, attestation jsonb NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pos_sync_private.shift_author_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_private.shift_author_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER shift_author_receipt_immutable BEFORE UPDATE OR DELETE ON pos_sync_private.shift_author_receipts
 FOR EACH ROW EXECUTE FUNCTION pos_sync_private.receipt_immutable();

-- The four existing Main action keys and their current page associations. An
-- enabled alternative page remains sufficient; a role title never grants them.
CREATE FUNCTION pos_sync_private.shift_author_flag(p_permissions jsonb,p_flag text) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT COALESCE(p_permissions->p_flag='true'::jsonb,false) AND EXISTS(
  SELECT 1 FROM jsonb_array_elements_text(
   '{"can_shift_cash_count":["shifts"],"can_close_shift":["shifts"],"can_shift_cash_recount":["shifts"],"can_shift_variance_approve":["shifts"]}'::jsonb->p_flag) page
  WHERE p_permissions->('page:'||page) IS DISTINCT FROM 'false'::jsonb)
$fn$;
REVOKE ALL ON FUNCTION pos_sync_private.shift_author_flag(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION pos_sync_private.shift_author_management_allowed(p_role text,p_slug text,p_permissions jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT COALESCE(p_role='admin' OR p_slug='admin',false) OR COALESCE(CASE WHEN COALESCE(p_permissions,'{}'::jsonb) ? 'can_use_management_pc'
  THEN p_permissions->'can_use_management_pc'='true'::jsonb ELSE p_role='manager' OR p_slug='supervisor' END,false)
$fn$;
REVOKE ALL ON FUNCTION pos_sync_private.shift_author_management_allowed(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Every graph helper calls this before enabling the existing financial writer.
-- Normal OPEN postimages, unchanged history and delivery/acknowledgement metadata
-- retain their existing semantics. No enrolled identity can downgrade to legacy.
CREATE FUNCTION public.pos_sync_shift_author_guard(p_table text,p_rows jsonb,p_changes jsonb,p_branch text,p_terminal text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE submitted jsonb; candidate jsonb; saved jsonb; parent public.shifts%ROWTYPE; v_shift_id uuid; change jsonb; row_key jsonb;
 enrolled boolean; proof jsonb; safe text[]; financial text[]; clean_open boolean; lock_terminal text; old_terminal text; terminal_branch text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 IF p_table<>ALL(ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts']) THEN RETURN; END IF;
 IF NULLIF(p_terminal,'') IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('shift-author-terminal:'||p_terminal,0));
  SELECT location_id INTO terminal_branch FROM public.terminal_tokens WHERE id::text=p_terminal AND status IN ('active','used') AND revoked_at IS NULL FOR SHARE;
  IF NOT FOUND OR (terminal_branch IS NOT NULL AND terminal_branch IS DISTINCT FROM p_branch) THEN RAISE EXCEPTION 'SYNC_TERMINAL_SCOPE_FORBIDDEN'; END IF;
 END IF;
 enrolled:=EXISTS(SELECT 1 FROM pos_sync_private.shift_author_keys WHERE terminal_id=p_terminal);
 FOR change IN SELECT value FROM jsonb_array_elements(COALESCE(p_changes,'[]')) c WHERE upper(COALESCE(c->>'operation','')) IN ('D','DELETE') LOOP
  IF enrolled OR (NULLIF(p_terminal,'') IS NULL AND current_setting('pos.shift_author_raw',true) IS DISTINCT FROM 'on' AND EXISTS(SELECT 1 FROM pos_sync_private.shift_author_keys)) THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_REQUIRED'; END IF;
  row_key:=COALESCE(change->'key',(change->>'entityId')::jsonb,(change->>'entity_id')::jsonb);
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',p_table) INTO saved USING (row_key->>'id')::uuid;
  v_shift_id:=CASE WHEN p_table='shifts' THEN (saved->>'id')::uuid ELSE (saved->>'shift_id')::uuid END;
  SELECT * INTO parent FROM public.shifts WHERE id=v_shift_id FOR SHARE;
  IF parent.terminal_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock_shared(hashtextextended('shift-author-terminal:'||parent.terminal_id,0)); END IF;
  IF EXISTS(SELECT 1 FROM pos_sync_private.shift_author_keys WHERE terminal_id=parent.terminal_id) OR
    EXISTS(SELECT 1 FROM pos_sync_private.shift_author_receipts r WHERE r.shift_id=v_shift_id) THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_REQUIRED'; END IF;
 END LOOP;
 proof:=NULLIF(current_setting('pos.shift_author',true),'')::jsonb;
 FOR submitted IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows,'[]')) LOOP
  v_shift_id:=CASE WHEN p_table='shifts' THEN (submitted->>'id')::uuid ELSE (submitted->>'shift_id')::uuid END;
  SELECT * INTO parent FROM public.shifts WHERE id=v_shift_id FOR SHARE;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',p_table) INTO saved USING (submitted->>'id')::uuid;
  SELECT terminal_id INTO old_terminal FROM public.shifts WHERE id=CASE WHEN p_table='shifts' THEN (saved->>'id')::uuid ELSE (saved->>'shift_id')::uuid END;
  FOR lock_terminal IN SELECT DISTINCT value FROM unnest(ARRAY[parent.terminal_id,old_terminal,submitted->>'terminal_id']) value WHERE value IS NOT NULL ORDER BY value LOOP
   PERFORM pg_advisory_xact_lock_shared(hashtextextended('shift-author-terminal:'||lock_terminal,0));
  END LOOP;
  enrolled:=EXISTS(SELECT 1 FROM pos_sync_private.shift_author_keys WHERE terminal_id=p_terminal OR terminal_id=parent.terminal_id OR terminal_id=old_terminal OR terminal_id=submitted->>'terminal_id') OR
    EXISTS(SELECT 1 FROM pos_sync_private.shift_author_receipts r WHERE r.shift_id=v_shift_id OR r.shift_id=(saved->>'shift_id')::uuid) OR
    (NULLIF(p_terminal,'') IS NULL AND current_setting('pos.shift_author_raw',true) IS DISTINCT FROM 'on' AND EXISTS(SELECT 1 FROM pos_sync_private.shift_author_keys));
  IF NOT enrolled THEN CONTINUE; END IF;
  IF proof IS NOT NULL AND proof->>'terminalId'=p_terminal AND lower(btrim(proof->>'branchId'))=lower(btrim(p_branch)) AND (proof->>'shiftId')::uuid=v_shift_id THEN CONTINUE; END IF;
  EXECUTE format('SELECT to_jsonb(jsonb_populate_record(NULL::public.%I,$1))',p_table) INTO candidate USING submitted;
  safe:=CASE p_table WHEN 'shifts' THEN ARRAY['note','overdue','updated_at','row_version']
    WHEN 'shift_notifications' THEN ARRAY['channels','updated_at','row_version']
    WHEN 'shift_variance_alerts' THEN ARRAY['delivery_status','attempts','last_error','last_attempt_at','acknowledged_at','acknowledged_by','updated_at','row_version']
    ELSE ARRAY[]::text[] END;
  IF saved IS NOT NULL AND candidate-safe IS NOT DISTINCT FROM saved-safe THEN CONTINUE; END IF;
  IF saved IS NOT NULL AND p_table=ANY(ARRAY['shift_cash_counts','shift_reconciliations','shift_close_events']) AND
   (candidate IS NOT DISTINCT FROM pos_sync_private.download_projection(saved,p_table,false) OR candidate IS NOT DISTINCT FROM pos_sync_private.download_projection(saved,p_table,true)) THEN CONTINUE; END IF;
  IF p_table='shifts' THEN
   financial:=ARRAY['status','state','closed_at','closed_by_name','closed_by_staff_id','closed_by_role','counted_cash','counted_card','counted_digital',
    'expected_cash','expected_card','expected_digital','closing_float','final_counted_cash','variance_cash','variance_card','variance_digital','variance_total','variance_status','close_reason','closing_started_at','closing_started_by'];
   clean_open:=COALESCE(candidate->>'status','OPEN')='OPEN' AND COALESCE(candidate->>'state','ACTIVE')='ACTIVE' AND NOT EXISTS(
    SELECT 1 FROM unnest(financial) field WHERE field<>ALL(ARRAY['status','state']) AND candidate->>field IS NOT NULL);
   IF clean_open AND (saved IS NULL OR candidate-safe-financial IS NOT DISTINCT FROM saved-safe-financial) THEN CONTINUE; END IF;
  END IF;
  RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_REQUIRED';
 END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_shift_author_guard(text,jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_shift_author_guard(text,jsonb,jsonb,text,text) TO service_role;
CREATE FUNCTION public.pos_sync_shift_author_receipt_guard(p_batch_id uuid,p_terminal_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE accepted pos_sync_private.shift_author_receipts%ROWTYPE; proof jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 SELECT * INTO accepted FROM pos_sync_private.shift_author_receipts WHERE intent_id=p_batch_id;
 IF NOT FOUND THEN RETURN; END IF;
 proof:=NULLIF(current_setting('pos.shift_author',true),'')::jsonb;
 IF proof IS DISTINCT FROM accepted.attestation OR accepted.terminal_id IS DISTINCT FROM p_terminal_id THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_REQUIRED'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_shift_author_receipt_guard(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_shift_author_receipt_guard(uuid,text) TO service_role;

-- Only the existing relay-authorized notification mutations and shift deletion
-- enter this constrained RPC. Admission and DML share one transaction/row lock.
CREATE FUNCTION public.pos_sync_shift_author_raw_write(p_operation jsonb,p_terminal_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE table_name text:=p_operation->>'table'; kind text:=p_operation->>'kind'; submitted jsonb; saved jsonb; effective jsonb; matched record;
 fields text[]; columns_sql text; updates_sql text; where_sql text; statement text; previous_raw text; keyed boolean; target_ids uuid[];
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 IF NOT (table_name='shift_notifications' AND kind=ANY(ARRAY['insert','upsert','update','delete']) OR table_name='shifts' AND kind='delete') THEN RAISE EXCEPTION 'SYNC_SHIFT_RAW_OPERATION_FORBIDDEN'; END IF;
 IF NULLIF(p_terminal_id,'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.terminal_tokens WHERE id::text=p_terminal_id AND status IN ('active','used') AND revoked_at IS NULL FOR SHARE)
 THEN RAISE EXCEPTION 'SYNC_TERMINAL_SCOPE_FORBIDDEN'; END IF;
 previous_raw:=current_setting('pos.shift_author_raw',true);PERFORM set_config('pos.shift_author_raw','on',true);
 IF kind=ANY(ARRAY['insert','upsert']) THEN
  keyed:=NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_operation->'rows') row WHERE jsonb_typeof(row->'id') IS DISTINCT FROM 'string' OR row->>'id'='');
  FOR submitted IN SELECT value FROM jsonb_array_elements(p_operation->'rows') LOOP
   SELECT array_agg(key ORDER BY key) INTO fields FROM jsonb_object_keys(submitted) key;
   IF fields IS NULL OR EXISTS(SELECT 1 FROM unnest(fields) field WHERE NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.shift_notifications'::regclass AND attname=field AND attnum>0 AND NOT attisdropped)) THEN RAISE EXCEPTION 'SYNC_SHIFT_RAW_OPERATION_FORBIDDEN'; END IF;
   PERFORM id FROM public.shifts WHERE id=(submitted->>'shift_id')::uuid FOR SHARE;
   SELECT to_jsonb(row) INTO saved FROM public.shift_notifications row WHERE shift_id=(submitted->>'shift_id')::uuid FOR UPDATE;
   effective:=COALESCE(saved,'{}'::jsonb)||submitted;
   PERFORM public.pos_sync_shift_author_guard(table_name,jsonb_build_array(effective),'[]',effective->>'store_id',p_terminal_id);
   SELECT string_agg(quote_ident(field),','),string_agg(format('%I=EXCLUDED.%I',field,field),',') INTO columns_sql,updates_sql FROM unnest(fields) field;
   statement:=format('INSERT INTO public.shift_notifications(%s) SELECT %s FROM jsonb_populate_record(NULL::public.shift_notifications,$1)',columns_sql,columns_sql);
   IF kind='upsert' OR keyed THEN statement:=statement||' ON CONFLICT(shift_id) DO UPDATE SET '||updates_sql; END IF;
   EXECUTE statement USING submitted;
  END LOOP;
 ELSE
  SELECT array_agg(key ORDER BY key) INTO fields FROM jsonb_object_keys(p_operation->'match') key;
  IF fields IS NULL OR EXISTS(SELECT 1 FROM unnest(fields) field WHERE NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.'||table_name) AND attname=field AND attnum>0 AND NOT attisdropped)) THEN RAISE EXCEPTION 'SYNC_SHIFT_RAW_OPERATION_FORBIDDEN'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(p_operation->'match') field WHERE jsonb_typeof(field.value)=ANY(ARRAY['array','object'])) THEN RAISE EXCEPTION 'SYNC_SHIFT_RAW_OPERATION_FORBIDDEN'; END IF;
  SELECT string_agg(format('x.%I=(jsonb_populate_record(NULL::public.%I,$1)).%I',field,table_name,field),' AND ') INTO where_sql FROM unnest(fields) field;
  IF kind='update' THEN
   SELECT array_agg(key ORDER BY key) INTO fields FROM jsonb_object_keys(p_operation->'values') key;
   IF fields IS NULL THEN PERFORM set_config('pos.shift_author_raw',COALESCE(previous_raw,''),true);RETURN jsonb_build_object('ok',true); END IF;
   IF EXISTS(SELECT 1 FROM unnest(fields) field WHERE NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.shift_notifications'::regclass AND attname=field AND attnum>0 AND NOT attisdropped)) THEN RAISE EXCEPTION 'SYNC_SHIFT_RAW_OPERATION_FORBIDDEN'; END IF;
   PERFORM jsonb_populate_record(NULL::public.shift_notifications,p_operation->'values');
   SELECT string_agg(format('%I=(jsonb_populate_record(NULL::public.shift_notifications,$2)).%I',field,field),',') INTO updates_sql FROM unnest(fields) field;
  END IF;
  EXECUTE format('SELECT array_agg(x.id) FROM public.%I x WHERE %s',table_name,where_sql) INTO target_ids USING p_operation->'match';
  -- Follow the closing writer's parent-before-child order. The fixed id set
  -- also excludes rows inserted after the checked filter snapshot.
  IF table_name='shifts' THEN PERFORM id FROM public.shifts WHERE id=ANY(target_ids) ORDER BY id FOR SHARE;
  ELSE
   PERFORM sh.id FROM public.shifts sh WHERE sh.id IN(SELECT shift_id FROM public.shift_notifications WHERE id=ANY(target_ids)) ORDER BY sh.id FOR SHARE;
   IF kind='update' AND p_operation->'values' ? 'shift_id' THEN PERFORM id FROM public.shifts WHERE id=(p_operation->'values'->>'shift_id')::uuid FOR SHARE; END IF;
  END IF;
  FOR matched IN EXECUTE format('SELECT to_jsonb(x) saved FROM public.%I x WHERE %s AND x.id=ANY($2) ORDER BY id FOR UPDATE',table_name,where_sql) USING p_operation->'match',target_ids LOOP
   saved:=matched.saved;
   IF kind='delete' THEN
    PERFORM public.pos_sync_shift_author_guard(table_name,'[]',jsonb_build_array(jsonb_build_object('operation','DELETE','key',jsonb_build_object('id',saved->'id'))),saved->>'store_id',p_terminal_id);
    EXECUTE format('DELETE FROM public.%I WHERE id=$1::uuid',table_name) USING saved->>'id';
   ELSE
    effective:=saved||(p_operation->'values');
    PERFORM public.pos_sync_shift_author_guard(table_name,jsonb_build_array(effective),'[]',effective->>'store_id',p_terminal_id);
    -- Mutate only the rows that were actually locked and checked. A later
    -- concurrent insert matching a broad filter must not evade admission.
    EXECUTE format('UPDATE public.shift_notifications SET %s WHERE id=$1::uuid',updates_sql) USING saved->>'id',p_operation->'values';
   END IF;
  END LOOP;
 END IF;
 PERFORM set_config('pos.shift_author_raw',COALESCE(previous_raw,''),true);
 RETURN jsonb_build_object('ok',true);
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_shift_author_raw_write(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_shift_author_raw_write(jsonb,text) TO service_role;

-- The hosted endpoint verifies Ed25519 before calling this service-only API.
-- It forwards the current-author decision, including denial, rather than doing
-- a racy API read to decide whether this is an accepted receipt replay.
CREATE FUNCTION public.pos_sync_push_author_shift_intent(p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_operations jsonb,p_shift_intent jsonb,p_shift_author jsonb,p_author_authority jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET timezone='UTC' AS $fn$
DECLARE intent jsonb; receipt pos_sync_private.shift_intent_receipts%ROWTYPE; historical pos_sync_private.shift_author_receipts%ROWTYPE;
 registered pos_sync_private.shift_author_keys%ROWTYPE; person public.app_users%ROWTYPE;
 hash text; v_shift uuid; action text; result jsonb; op jsonb; proposed jsonb; old jsonb; authorized boolean; previous_proof text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 IF p_shift_intent->>'payloadJson' IS NULL OR octet_length(convert_to(p_shift_intent->>'payloadJson','UTF8'))>6*1024*1024 THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_INVALID'; END IF;
 intent:=(p_shift_intent->>'payloadJson')::jsonb; hash:=encode(sha256(convert_to(p_shift_intent->>'payloadJson','UTF8')),'hex');
 v_shift:=(intent->>'shiftId')::uuid; action:=intent->>'kind';
 IF p_shift_author->'version' IS DISTINCT FROM '1'::jsonb OR p_shift_author->>'algorithm' IS DISTINCT FROM 'Ed25519' OR
   p_shift_author->>'terminalId' IS DISTINCT FROM p_terminal_id OR lower(btrim(p_shift_author->>'branchId')) IS DISTINCT FROM lower(btrim(p_branch_id)) OR
   (p_shift_author->>'shiftId')::uuid IS DISTINCT FROM v_shift OR (p_shift_author->>'intentId')::uuid IS DISTINCT FROM p_batch_id OR
   p_shift_author->>'action' IS DISTINCT FROM action OR p_shift_author->>'payloadHash' IS DISTINCT FROM hash
 THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_INVALID'; END IF;
 SELECT * INTO registered FROM pos_sync_private.shift_author_keys WHERE key_id=(p_shift_author->>'keyId')::uuid AND author_id=(p_shift_author->>'authorId')::uuid
  AND terminal_id=p_terminal_id AND project_origin=p_shift_author->>'projectOrigin' AND subject=p_shift_author->>'subject' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_INVALID'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-batch:'||p_batch_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-intent:'||p_batch_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:'||v_shift::text,0));
 SELECT * INTO receipt FROM pos_sync_private.shift_intent_receipts WHERE intent_id=p_batch_id;
 IF FOUND THEN
  SELECT * INTO historical FROM pos_sync_private.shift_author_receipts WHERE intent_id=p_batch_id;
  IF NOT FOUND OR historical.attestation IS DISTINCT FROM p_shift_author OR
    ROW(receipt.branch_id,receipt.terminal_id,receipt.shift_id,receipt.payload_hash) IS DISTINCT FROM ROW(p_branch_id,p_terminal_id,v_shift,hash)
  THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_HISTORY_UNPROVEN'; END IF;
  previous_proof:=current_setting('pos.shift_author',true);PERFORM set_config('pos.shift_author',p_shift_author::text,true);
  result:=public.pos_sync_push_shift_intent(p_batch_id,p_organization_id,p_branch_id,p_terminal_id,p_operations,p_shift_intent);
  PERFORM set_config('pos.shift_author',COALESCE(previous_proof,''),true);
  RETURN result;
 END IF;
 -- Only NEW writes reach this point. Row locks make a concurrent key/account/
 -- permission revocation wait for this transaction, without locking sales.
 IF p_author_authority->'allowed' IS DISTINCT FROM 'true'::jsonb OR p_author_authority->'authority'->>'authorId' IS DISTINCT FROM registered.author_id::text OR registered.revoked_at IS NOT NULL
 THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_PERMISSION_REVOKED'; END IF;
 SELECT * INTO person FROM public.app_users WHERE id=registered.author_id FOR SHARE;
 IF NOT FOUND OR person.is_active IS DISTINCT FROM true OR person.user_id IS DISTINCT FROM registered.subject OR
   (person.store_id IS NOT NULL AND lower(btrim(person.store_id)) IS DISTINCT FROM lower(btrim(p_branch_id)))
 THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_PERMISSION_REVOKED'; END IF;
 IF EXISTS(SELECT 1 FROM public.terminal_tokens WHERE id::text=p_terminal_id AND location_id IS NULL) AND
   NOT pos_sync_private.shift_author_management_allowed(person.role,person.role_slug,person.permissions)
 THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_PERMISSION_REVOKED'; END IF;
 authorized:=CASE action WHEN 'ORIGINAL' THEN pos_sync_private.shift_author_flag(person.permissions,'can_shift_cash_count') OR pos_sync_private.shift_author_flag(person.permissions,'can_close_shift')
  WHEN 'RECOUNT' THEN pos_sync_private.shift_author_flag(person.permissions,'can_shift_cash_recount')
  WHEN 'VARIANCE' THEN pos_sync_private.shift_author_flag(person.permissions,'can_shift_variance_approve') ELSE false END;
 IF NOT COALESCE(authorized,false) THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_PERMISSION_REVOKED'; END IF;
 FOR op IN SELECT value FROM jsonb_array_elements(intent->'operations') LOOP
  IF action='ORIGINAL' AND op->>'table'='shifts' AND EXISTS(SELECT 1 FROM jsonb_array_elements(op->'rows') p WHERE p->>'closed_by_staff_id' IS DISTINCT FROM registered.subject OR p->>'closed_by_name' IS DISTINCT FROM registered.subject)
  THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_ACTOR_MISMATCH'; END IF;
  IF op->>'table'='activity_events' AND EXISTS(SELECT 1 FROM jsonb_array_elements(op->'rows') p WHERE p->>'actor_name' IS DISTINCT FROM registered.subject AND NOT EXISTS(SELECT 1 FROM public.activity_events a WHERE a.id=(p->>'id')::uuid))
  THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_ACTOR_MISMATCH'; END IF;
  IF op->>'table'=ANY(ARRAY['shift_cash_counts','shift_close_events']) THEN
   FOR proposed IN SELECT value FROM jsonb_array_elements(op->'rows') LOOP
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1',op->>'table') INTO old USING (proposed->>'id')::uuid;
    IF old IS NOT NULL THEN CONTINUE; END IF;
    IF op->>'table'='shift_cash_counts' AND (proposed->>'counted_by_staff_id' IS DISTINCT FROM registered.subject OR proposed->>'counted_by_name' IS DISTINCT FROM registered.subject OR
      proposed->>'kind' IS DISTINCT FROM CASE action WHEN 'ORIGINAL' THEN 'ORIGINAL' WHEN 'RECOUNT' THEN 'RECOUNT' ELSE '' END) THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_ACTOR_MISMATCH'; END IF;
    IF op->>'table'='shift_close_events' AND (proposed->>'actor_staff_id' IS DISTINCT FROM registered.subject OR proposed->>'actor_name' IS DISTINCT FROM registered.subject OR
      (action='ORIGINAL' AND NOT COALESCE(proposed->>'event'=ANY(ARRAY['cash_count_submitted','reconciled']),false)) OR (action='RECOUNT' AND proposed->>'event' IS DISTINCT FROM 'recount_submitted') OR (action='VARIANCE' AND proposed->>'event' IS DISTINCT FROM 'variance_approved'))
    THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_ACTOR_MISMATCH'; END IF;
   END LOOP;
  END IF;
 END LOOP;
 previous_proof:=current_setting('pos.shift_author',true);
 PERFORM set_config('pos.shift_author',p_shift_author::text,true);
 result:=public.pos_sync_push_shift_intent(p_batch_id,p_organization_id,p_branch_id,p_terminal_id,p_operations,p_shift_intent);
 PERFORM set_config('pos.shift_author',COALESCE(previous_proof,''),true);
 INSERT INTO pos_sync_private.shift_author_receipts(intent_id,shift_id,terminal_id,branch_id,key_id,author_id,attestation)
 VALUES(p_batch_id,v_shift,p_terminal_id,p_branch_id,registered.key_id,registered.author_id,p_shift_author);
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_push_author_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_author_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb) TO service_role;

-- Guard the complete helper family, so a child-only batch cannot omit its
-- parent to bypass admission. Existing typed personal functions do not use
-- these terminal transport helpers and retain their own authorization.
-- SHIFT_AUTHOR_HELPER_GUARDS_BEGIN
DO $helper_guards$
DECLARE table_name text; operation text; signature regprocedure; definition text; addition text; position integer;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts'] LOOP
  FOREACH operation IN ARRAY ARRAY['apply','delete'] LOOP
   signature:=to_regprocedure(format('public.sync_%s_%s(%s)',operation,table_name,CASE operation WHEN 'apply' THEN 'jsonb' ELSE 'jsonb,text,text' END));
   IF signature IS NULL THEN RAISE EXCEPTION 'AUTH37_MISSING_GRAPH_HELPER'; END IF;
   definition:=pg_get_functiondef(signature);
   addition:=CASE operation WHEN 'apply' THEN format(E'PERFORM public.pos_sync_shift_author_guard(%L,p_rows,\'[]\'::jsonb,current_setting(\'pos.sync_branch\',true),current_setting(\'pos.sync_terminal\',true));\n',table_name)
    ELSE format(E'PERFORM public.pos_sync_shift_author_guard(%L,\'[]\'::jsonb,p_changes,p_branch_id,p_terminal_id);\n',table_name) END;
   IF strpos(definition,addition)=0 THEN
    position:=strpos(definition,'BEGIN');
    IF position=0 THEN RAISE EXCEPTION 'AUTH37_UNEXPECTED_GRAPH_HELPER'; END IF;
    EXECUTE overlay(definition placing E'BEGIN\n '||addition from position for 5);
   END IF;
  END LOOP;
 END LOOP;
END $helper_guards$;
DO $receipt_guards$
DECLARE signature regprocedure; definition text;
 anchor text;
 addition text:='PERFORM public.pos_sync_shift_author_receipt_guard(p_batch_id,p_terminal_id);';
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.pos_sync_push_batch(uuid,text,text,text,text,jsonb,jsonb)'::regprocedure,
  'public.pos_sync_push_aggregate(uuid,text,text,text,jsonb)'::regprocedure,'public.pos_sync_push_shift_intent(uuid,text,text,text,jsonb,jsonb)'::regprocedure] LOOP
  definition:=pg_get_functiondef(signature);
  anchor:=CASE WHEN signature='public.pos_sync_push_shift_intent(uuid,text,text,text,jsonb,jsonb)'::regprocedure
   THEN 'PERFORM pg_advisory_xact_lock(hashtextextended(''pos-sync-batch:''||p_batch_id::text,0));'
   ELSE 'PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''pos-sync-batch:'' || p_batch_id::text, 0));' END;
  IF strpos(definition,addition)=0 THEN
   IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'AUTH37_UNEXPECTED_RECEIPT_LOCK'; END IF;
   EXECUTE replace(definition,anchor,anchor||E'\n '||addition);
  END IF;
 END LOOP;
END $receipt_guards$;
-- SHIFT_AUTHOR_HELPER_GUARDS_END
DO $enrollment_lock$
DECLARE definition text; anchor text:='PERFORM pg_advisory_xact_lock(hashtextextended(''shift-author:''';
 addition text:='PERFORM pg_advisory_xact_lock(hashtextextended(''shift-author-terminal:''||v_terminal,0));';
BEGIN
 definition:=pg_get_functiondef('public.pos_shift_author_enroll(jsonb,text)'::regprocedure);
 IF strpos(definition,addition)=0 THEN
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'AUTH37_UNEXPECTED_ENROLLMENT_LOCK'; END IF;
  EXECUTE replace(definition,anchor,addition||E'\n '||anchor);
 END IF;
END $enrollment_lock$;
NOTIFY pgrst,'reload schema';
COMMIT;
