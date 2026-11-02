-- Source preparation only. The hosted endpoint verifies both Ed25519 domains.
BEGIN;
DO $prerequisite$ BEGIN
 IF to_regclass('pos_sync_private.shift_author_receipts') IS NULL OR
    to_regprocedure('public.pos_sync_push_author_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb)') IS NULL OR
    to_regclass('pos_sync_private.shift_closing_start_receipts') IS NOT NULL
 THEN RAISE EXCEPTION 'SHIFT_START_REQUIRES_REVIEWED_AUTH37'; END IF;
END $prerequisite$;
CREATE TABLE pos_sync_private.shift_closing_start_receipts (
 intent_id uuid PRIMARY KEY REFERENCES pos_sync_private.shift_author_receipts(intent_id) ON DELETE RESTRICT,
 event_id uuid NOT NULL UNIQUE, key_id uuid NOT NULL REFERENCES pos_sync_private.shift_author_keys(key_id) ON DELETE RESTRICT,
 author_id uuid NOT NULL, proof jsonb NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pos_sync_private.shift_closing_start_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pos_sync_private.shift_closing_start_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER shift_closing_start_receipt_immutable BEFORE UPDATE OR DELETE ON pos_sync_private.shift_closing_start_receipts
 FOR EACH ROW EXECUTE FUNCTION pos_sync_private.receipt_immutable();

-- Only the extended service RPC sets this transaction-local validated context.
-- Compare typed persisted facts, retaining the original signed JSON bytes.
CREATE FUNCTION pos_sync_private.proven_closing_start(p_intent uuid,p_event jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT COALESCE((context->>'intentId')::uuid=p_intent AND (context->'proof'->>'eventId')::uuid=(p_event->>'id')::uuid AND
   (to_jsonb(jsonb_populate_record(NULL::public.shift_close_events,(context->'proof'->>'payloadJson')::jsonb->'event'))-'row_version'-'updated_at')=
   (to_jsonb(jsonb_populate_record(NULL::public.shift_close_events,p_event))-'row_version'-'updated_at'),false)
 FROM (SELECT NULLIF(current_setting('pos.shift_closing_start',true),'')::jsonb context) x
$fn$;
REVOKE ALL ON FUNCTION pos_sync_private.proven_closing_start(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Extend only the start-specific AUTH37 conditions. All other event actors,
-- count actors, financial checks, accepted receipts and causal checks are retained.
DO $bounded_extension$
DECLARE definition text; anchor text; replacement text;
BEGIN
 definition:=pg_get_functiondef('public.pos_sync_push_author_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 anchor:='IF op->>''table''=''shift_close_events'' AND (proposed->>''actor_staff_id'' IS DISTINCT FROM registered.subject OR proposed->>''actor_name'' IS DISTINCT FROM registered.subject OR';
 replacement:='IF op->>''table''=''shift_close_events'' AND ((NOT (action=''ORIGINAL'' AND proposed->>''event''=''closing_started'' AND pos_sync_private.proven_closing_start(p_batch_id,proposed)) AND (proposed->>''actor_staff_id'' IS DISTINCT FROM registered.subject OR proposed->>''actor_name'' IS DISTINCT FROM registered.subject)) OR';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'SHIFT_START_UNKNOWN_AUTHOR_EVENT_CHECK'; END IF;
 definition:=replace(definition,anchor,replacement);
 anchor:='AND parent->>''closing_started_by''=registered.subject';
 replacement:='AND parent->>''closing_started_by''=CASE WHEN pos_sync_private.proven_closing_start(p_batch_id,proposed) THEN proposed->>''actor_staff_id'' ELSE registered.subject END';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'SHIFT_START_UNKNOWN_AUTHOR_PARENT_CHECK'; END IF;
 definition:=replace(definition,anchor,replacement);
 -- The opening terminal is immutable attribution, not the registered terminal
 -- of the authorized closer. Only the outer RPC's validated start context can
 -- admit that distinction; ordinary eight-argument authors retain their guard.
 anchor:='AND parent->>''terminal_id''=p_terminal_id';
 replacement:='AND (parent->>''terminal_id''=p_terminal_id OR (action=''ORIGINAL'' AND pos_sync_private.proven_closing_start(p_batch_id,proposed)))';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'SHIFT_START_UNKNOWN_AUTHOR_TERMINAL_CHECK'; END IF;
 definition:=replace(definition,anchor,replacement);
 -- Omission must fail even on the old eight-argument accepted-replay endpoint.
 anchor:='SELECT * INTO receipt FROM pos_sync_private.shift_intent_receipts WHERE intent_id=p_batch_id;';
 replacement:=E'IF EXISTS(SELECT 1 FROM pos_sync_private.shift_closing_start_receipts s WHERE s.intent_id=p_batch_id AND s.proof IS DISTINCT FROM NULLIF(current_setting(\'pos.shift_closing_start\',true),\'\')::jsonb->\'proof\') THEN RAISE EXCEPTION \'SYNC_SHIFT_START_HISTORY_UNPROVEN\'; END IF;\n '||anchor;
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'SHIFT_START_UNKNOWN_AUTHOR_RECEIPT_CHECK'; END IF;
 EXECUTE replace(definition,anchor,replacement);
END $bounded_extension$;

CREATE FUNCTION public.pos_sync_push_started_shift_intent(p_batch_id uuid,p_organization_id text,p_branch_id text,p_terminal_id text,p_operations jsonb,p_shift_intent jsonb,p_shift_author jsonb,p_author_authority jsonb,p_closing_start jsonb,p_start_authority jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET timezone='UTC' AS $fn$
DECLARE raw text; payload jsonb; intent jsonb; parent jsonb; event_row jsonb; final_parent jsonb; old_event jsonb;
 registered pos_sync_private.shift_author_keys%ROWTYPE; person public.app_users%ROWTYPE; existing pos_sync_private.shift_closing_start_receipts%ROWTYPE;
 cloud_parent public.shifts%ROWTYPE; previous_context text; result jsonb; field text; v_shift uuid; event_count integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 IF jsonb_typeof(p_closing_start) IS DISTINCT FROM 'object' OR
    (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_closing_start) key) IS DISTINCT FROM
    ARRAY['algorithm','authorId','branchId','eventId','keyId','payloadHash','payloadJson','projectOrigin','shiftId','signature','subject','terminalId','version']::text[]
 THEN RAISE EXCEPTION 'SYNC_SHIFT_START_INVALID'; END IF;
 raw:=p_closing_start->>'payloadJson';
 IF raw IS NULL OR octet_length(convert_to(raw,'UTF8'))>16384 OR p_closing_start->'version' IS DISTINCT FROM '1'::jsonb OR
    p_closing_start->>'algorithm' IS DISTINCT FROM 'Ed25519' OR p_closing_start->>'signature' !~ '^[A-Za-z0-9_-]{86}$' OR
    p_closing_start->>'payloadHash' IS DISTINCT FROM encode(sha256(convert_to(raw,'UTF8')),'hex')
 THEN RAISE EXCEPTION 'SYNC_SHIFT_START_INVALID'; END IF;
 payload:=raw::jsonb; parent:=payload->'parent'; event_row:=payload->'event'; intent:=(p_shift_intent->>'payloadJson')::jsonb; v_shift:=(intent->>'shiftId')::uuid;
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(payload) key) IS DISTINCT FROM ARRAY['branchId','event','eventId','parent','shiftId','version']::text[] OR
    (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(parent) key) IS DISTINCT FROM ARRAY['close_reason','closing_started_at','closing_started_by','id','opened_at','opened_by_name','opened_by_staff_id','store_id','terminal_id']::text[] OR
    payload->'version' IS DISTINCT FROM '1'::jsonb OR intent->>'kind' IS DISTINCT FROM 'ORIGINAL' OR
    p_closing_start->>'projectOrigin' IS DISTINCT FROM p_shift_author->>'projectOrigin' OR p_closing_start->>'terminalId' IS DISTINCT FROM p_terminal_id OR
    lower(btrim(p_closing_start->>'branchId')) IS DISTINCT FROM lower(btrim(p_branch_id)) OR
    payload->>'branchId' IS DISTINCT FROM p_closing_start->>'branchId' OR (payload->>'shiftId')::uuid IS DISTINCT FROM v_shift OR
    (p_closing_start->>'shiftId')::uuid IS DISTINCT FROM v_shift OR (payload->>'eventId')::uuid IS DISTINCT FROM (p_closing_start->>'eventId')::uuid
 THEN RAISE EXCEPTION 'SYNC_SHIFT_START_INVALID'; END IF;
 IF jsonb_typeof(event_row) IS DISTINCT FROM 'object' OR event_row ?| ARRAY['row_version','updated_at'] OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(event_row) key WHERE NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.shift_close_events'::regclass AND attname=key AND attnum>0 AND NOT attisdropped)) OR
    (event_row->>'id')::uuid IS DISTINCT FROM (payload->>'eventId')::uuid OR (event_row->>'shift_id')::uuid IS DISTINCT FROM v_shift OR
    lower(btrim(event_row->>'store_id')) IS DISTINCT FROM lower(btrim(p_branch_id)) OR event_row->>'terminal_id' IS DISTINCT FROM p_terminal_id OR
    event_row->>'event' IS DISTINCT FROM 'closing_started' OR event_row->>'from_state' IS DISTINCT FROM 'ACTIVE' OR event_row->>'to_state' IS DISTINCT FROM 'CASH_COUNT_REQUIRED' OR
    event_row->>'actor_staff_id' IS DISTINCT FROM p_closing_start->>'subject' OR event_row->>'actor_name' IS DISTINCT FROM p_closing_start->>'subject' OR
    event_row->>'created_at' IS NULL OR parent->>'closing_started_by' IS DISTINCT FROM p_closing_start->>'subject' OR
    (parent->>'closing_started_at')::timestamptz IS DISTINCT FROM (event_row->>'created_at')::timestamptz OR
    parent->>'close_reason' IS DISTINCT FROM event_row->'detail'->>'reason' OR (parent->>'id')::uuid IS DISTINCT FROM v_shift OR
    lower(btrim(parent->>'store_id')) IS DISTINCT FROM lower(btrim(p_branch_id))
 THEN RAISE EXCEPTION 'SYNC_SHIFT_START_INVALID'; END IF;
 -- Locks share the existing financial writer order. Proof is not a predecessor.
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-batch:'||p_batch_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-intent:'||p_batch_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:'||v_shift::text,0));
 SELECT * INTO registered FROM pos_sync_private.shift_author_keys WHERE key_id=(p_closing_start->>'keyId')::uuid AND author_id=(p_closing_start->>'authorId')::uuid
   AND terminal_id=p_terminal_id AND project_origin=p_closing_start->>'projectOrigin' AND subject=p_closing_start->>'subject' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_SHIFT_START_INVALID'; END IF;
 SELECT * INTO existing FROM pos_sync_private.shift_closing_start_receipts WHERE intent_id=p_batch_id;
 IF FOUND THEN
  IF existing.proof IS DISTINCT FROM p_closing_start THEN RAISE EXCEPTION 'SYNC_SHIFT_START_HISTORY_UNPROVEN'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM pos_sync_private.shift_author_receipts WHERE intent_id=p_batch_id) OR EXISTS(SELECT 1 FROM pos_sync_private.shift_closing_start_receipts WHERE event_id=(p_closing_start->>'eventId')::uuid)
  THEN RAISE EXCEPTION 'SYNC_SHIFT_START_HISTORY_UNPROVEN'; END IF;
  IF p_start_authority->'allowed' IS DISTINCT FROM 'true'::jsonb OR p_start_authority->'authority'->>'authorId' IS DISTINCT FROM registered.author_id::text OR registered.revoked_at IS NOT NULL
  THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_PERMISSION_REVOKED'; END IF;
  SELECT * INTO person FROM public.app_users WHERE id=registered.author_id FOR SHARE;
  IF NOT FOUND OR person.is_active IS DISTINCT FROM true OR person.user_id IS DISTINCT FROM registered.subject OR
     (person.store_id IS NOT NULL AND lower(btrim(person.store_id)) IS DISTINCT FROM lower(btrim(p_branch_id))) OR
     NOT pos_sync_private.shift_author_flag(person.permissions,'can_close_shift') OR
     (EXISTS(SELECT 1 FROM public.terminal_tokens WHERE id::text=p_terminal_id AND location_id IS NULL) AND NOT pos_sync_private.shift_author_management_allowed(person.role,person.role_slug,person.permissions))
  THEN RAISE EXCEPTION 'SYNC_SHIFT_AUTHOR_PERMISSION_REVOKED'; END IF;
 END IF;
 SELECT count(*) INTO event_count FROM jsonb_array_elements(intent->'operations') op,LATERAL jsonb_array_elements(op->'rows') r
  WHERE op->>'table'='shift_close_events' AND r->>'event'='closing_started';
 IF event_count<>1 THEN RAISE EXCEPTION 'SYNC_SHIFT_START_INVALID'; END IF;
 SELECT r INTO old_event FROM jsonb_array_elements(intent->'operations') op,LATERAL jsonb_array_elements(op->'rows') r WHERE op->>'table'='shift_close_events' AND r->>'event'='closing_started';
 IF (to_jsonb(jsonb_populate_record(NULL::public.shift_close_events,old_event))-'row_version'-'updated_at') IS DISTINCT FROM
    (to_jsonb(jsonb_populate_record(NULL::public.shift_close_events,event_row))-'row_version'-'updated_at') THEN RAISE EXCEPTION 'SYNC_SHIFT_START_INVALID'; END IF;
 SELECT r INTO final_parent FROM jsonb_array_elements(intent->'operations') op,LATERAL jsonb_array_elements(op->'rows') r WHERE op->>'table'='shifts' AND (r->>'id')::uuid=v_shift;
 IF final_parent IS NULL THEN RAISE EXCEPTION 'SYNC_SHIFT_START_INVALID'; END IF;
 -- The freezer can preserve accepted cloud opening microseconds, while Main's
 -- actual parent postimage has SQL Server millisecond precision. Compare that
 -- immutable opening identity at native precision without rewriting either JSON.
 IF date_trunc('milliseconds',(parent->>'opened_at')::timestamptz) IS DISTINCT FROM date_trunc('milliseconds',(final_parent->>'opened_at')::timestamptz)
 THEN RAISE EXCEPTION 'SYNC_SHIFT_START_INVALID'; END IF;
 FOREACH field IN ARRAY ARRAY['id','store_id','terminal_id','opened_by_staff_id','opened_by_name','closing_started_at','closing_started_by','close_reason'] LOOP
  IF (to_jsonb(jsonb_populate_record(NULL::public.shifts,parent))->field) IS DISTINCT FROM (to_jsonb(jsonb_populate_record(NULL::public.shifts,final_parent))->field)
  THEN RAISE EXCEPTION 'SYNC_SHIFT_START_INVALID'; END IF;
 END LOOP;
 SELECT * INTO cloud_parent FROM public.shifts WHERE id=v_shift FOR SHARE;
 -- Preserve the original opening terminal, including historical NULL, against
 -- the locked cloud record and the already-compared final signed parent. The
 -- actual starter/event/key and counter remain bound to p_terminal_id above.
 IF NOT FOUND OR cloud_parent.store_id IS DISTINCT FROM p_branch_id OR cloud_parent.terminal_id IS DISTINCT FROM parent->>'terminal_id' OR
    date_trunc('milliseconds',cloud_parent.opened_at) IS DISTINCT FROM date_trunc('milliseconds',(parent->>'opened_at')::timestamptz) OR
    cloud_parent.opened_by_staff_id IS DISTINCT FROM parent->>'opened_by_staff_id' OR cloud_parent.opened_by_name IS DISTINCT FROM parent->>'opened_by_name'
 THEN RAISE EXCEPTION 'SYNC_SHIFT_START_INVALID'; END IF;
 previous_context:=current_setting('pos.shift_closing_start',true);
 PERFORM set_config('pos.shift_closing_start',jsonb_build_object('intentId',p_batch_id,'proof',p_closing_start)::text,true);
 result:=public.pos_sync_push_author_shift_intent(p_batch_id,p_organization_id,p_branch_id,p_terminal_id,p_operations,p_shift_intent,p_shift_author,p_author_authority);
 IF existing.intent_id IS NULL THEN
  INSERT INTO pos_sync_private.shift_closing_start_receipts(intent_id,event_id,key_id,author_id,proof) VALUES(p_batch_id,(p_closing_start->>'eventId')::uuid,registered.key_id,registered.author_id,p_closing_start);
 END IF;
 PERFORM set_config('pos.shift_closing_start',COALESCE(previous_context,''),true);
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_push_started_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_push_started_shift_intent(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
