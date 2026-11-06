-- PREPARED ONLY: exact-project approval is required before live application.
-- Dedicated admin-reviewed legacy admission; normal ORIGINAL/FIN62 guards unchanged.
BEGIN;
CREATE TABLE pos_sync_private.legacy_shift_recovery_receipts(
 recovery_id uuid PRIMARY KEY,organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text NOT NULL,shift_id uuid NOT NULL,
 payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),evidence_hash text NOT NULL CHECK(evidence_hash~'^[a-f0-9]{64}$'),
 cloud_witness_hash text NOT NULL CHECK(cloud_witness_hash~'^[a-f0-9]{64}$'),payload_json text NOT NULL,attestation jsonb NOT NULL,
 reviewer_id uuid NOT NULL,reviewer_subject text NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 400),
 financial_verification text NOT NULL CHECK(financial_verification='UNVERIFIED_HISTORICAL'),
 accepted_graph jsonb NOT NULL,accepted_token text NOT NULL,coverage jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(octet_length(convert_to(payload_json,'UTF8'))<=262144)
);
ALTER TABLE pos_sync_private.legacy_shift_recovery_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos_sync_private.legacy_shift_recovery_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER legacy_shift_recovery_receipt_immutable BEFORE UPDATE OR DELETE ON pos_sync_private.legacy_shift_recovery_receipts
 FOR EACH ROW EXECUTE FUNCTION pos_sync_private.receipt_immutable();
CREATE INDEX legacy_shift_recovery_shift ON pos_sync_private.legacy_shift_recovery_receipts(branch_id,shift_id);

CREATE FUNCTION public.pos_sync_recover_legacy_closing(p_organization_id text,p_branch_id text,p_terminal_id text,p_payload_json text,p_attestation jsonb,p_authority jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $fn$
DECLARE payload jsonb;raw_graph jsonb;witness jsonb;graph jsonb:='[]'::jsonb;part jsonb;r jsonb;typed jsonb;parent public.shifts%ROWTYPE;
 incoming public.shifts%ROWTYPE;registered pos_sync_private.shift_author_keys%ROWTYPE;person public.app_users%ROWTYPE;
 prior pos_sync_private.legacy_shift_recovery_receipts%ROWTYPE;recovery uuid;sid uuid;hash text;local_hash text;witness_hash text;
 table_name text;names text[];provided text[];rows_json jsonb;current_graph jsonb;token text;coverage jsonb;capability jsonb;affected integer;
 fields text[]:=ARRAY['status','state','closed_at','closed_by_name','closed_by_staff_id','closed_by_role','counted_cash','counted_card','counted_digital',
 'expected_cash','expected_card','expected_digital','closing_float','final_counted_cash','variance_cash','variance_card','variance_digital','variance_total','variance_status','close_reason','closing_started_at','closing_started_by'];
 assignments text;current_setting_branch text;previous_shift_writer text;protected boolean;target_recon jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SYNC_FORBIDDEN';END IF;
 PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
 IF p_payload_json IS NULL OR octet_length(convert_to(p_payload_json,'UTF8'))>262144 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_OVERSIZED';END IF;
 payload:=p_payload_json::jsonb;
 IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR payload->>'version' IS DISTINCT FROM '1' OR
  (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(payload) key) IS DISTINCT FROM
  ARRAY['branchId','cloudGraphText','cloudWitnessHash','evidenceHash','financialVerification','localGraphText','reason','recoveryId','shiftId','terminalId','version']::text[] OR
  payload->>'branchId' IS DISTINCT FROM p_branch_id OR payload->>'terminalId' IS DISTINCT FROM p_terminal_id OR
  payload->>'financialVerification' IS DISTINCT FROM 'UNVERIFIED_HISTORICAL' OR length(btrim(payload->>'reason')) NOT BETWEEN 3 AND 400
 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_INVALID';END IF;
 recovery:=(payload->>'recoveryId')::uuid;sid:=(payload->>'shiftId')::uuid;
 hash:=encode(sha256(convert_to(p_payload_json,'UTF8')),'hex');
 local_hash:=encode(sha256(convert_to(payload->>'localGraphText','UTF8')),'hex');
 witness_hash:=encode(sha256(convert_to(payload->>'cloudGraphText','UTF8')),'hex');
 IF payload->>'evidenceHash' IS DISTINCT FROM local_hash OR payload->>'cloudWitnessHash' IS DISTINCT FROM witness_hash OR
  p_attestation->>'version' IS DISTINCT FROM '1' OR p_attestation->>'algorithm' IS DISTINCT FROM 'Ed25519' OR
  p_attestation->>'action' IS DISTINCT FROM 'LEGACY_CLOSING_RECOVERY_V1' OR p_attestation->>'terminalId' IS DISTINCT FROM p_terminal_id OR
  p_attestation->>'branchId' IS DISTINCT FROM p_branch_id OR p_attestation->>'shiftId' IS DISTINCT FROM sid::text OR
  p_attestation->>'recoveryId' IS DISTINCT FROM recovery::text OR p_attestation->>'payloadHash' IS DISTINCT FROM hash
 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_INVALID';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('legacy-shift-recovery:'||recovery::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('pos-sync-shift:'||sid::text,0));
 SELECT * INTO registered FROM pos_sync_private.shift_author_keys WHERE key_id=(p_attestation->>'keyId')::uuid AND author_id=(p_attestation->>'authorId')::uuid
  AND terminal_id=p_terminal_id AND project_origin=p_attestation->>'projectOrigin' AND subject=p_attestation->>'subject' FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEGACY_RECOVERY_AUTHOR_INVALID';END IF;
 SELECT * INTO prior FROM pos_sync_private.legacy_shift_recovery_receipts WHERE recovery_id=recovery;
 IF FOUND THEN
  IF ROW(prior.organization_id,prior.branch_id,prior.terminal_id,prior.shift_id,prior.payload_hash) IS DISTINCT FROM ROW(p_organization_id,p_branch_id,p_terminal_id,sid,hash) OR
   convert_to(prior.payload_json,'UTF8') IS DISTINCT FROM convert_to(p_payload_json,'UTF8') OR prior.attestation IS DISTINCT FROM p_attestation
  THEN RAISE EXCEPTION 'LEGACY_RECOVERY_REPLAY_MISMATCH';END IF;
  current_graph:=pos_sync_private.shift_graph(sid);PERFORM pos_sync_private.validate_graph(current_graph,p_branch_id,sid,true);
  token:=pos_sync_private.graph_token(current_graph);
  RETURN jsonb_build_object('version',1,'recovery_id',recovery,'payload_hash',hash,'evidence_hash',local_hash,'cloud_witness_hash',witness_hash,
    'branch_id',p_branch_id,'terminal_id',p_terminal_id,'shift_id',sid,'reviewer_id',registered.author_id,'key_id',registered.key_id,
    'accepted_graph_text',prior.accepted_graph::text,'accepted_graph_hash',encode(sha256(convert_to(prior.accepted_graph::text,'UTF8')),'hex'),
    'financial_verification','UNVERIFIED_HISTORICAL','provenance','ADMIN_REVIEWED_LEGACY','accepted_token',prior.accepted_token,'current_token',token,
    'superseded',prior.accepted_token<>token,'coverage',prior.coverage,'graph',jsonb_build_object('tables',current_graph,'graphToken',token,'closedAtRaw',current_graph->0->'rows'->0->'closed_at'));
 END IF;
 IF p_authority->'allowed' IS DISTINCT FROM 'true'::jsonb OR p_authority->>'authorId' IS DISTINCT FROM registered.author_id::text OR
  p_authority->>'subject' IS DISTINCT FROM registered.subject OR registered.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'LEGACY_RECOVERY_ADMIN_REQUIRED';END IF;
 SELECT * INTO person FROM public.app_users WHERE id=registered.author_id FOR SHARE NOWAIT;
 IF NOT FOUND OR person.is_active IS DISTINCT FROM true OR person.user_id IS DISTINCT FROM registered.subject OR
  NOT(COALESCE(person.role::text,'')='admin' OR COALESCE(person.role_slug,'')='admin') OR (person.store_id IS NOT NULL AND person.store_id IS DISTINCT FROM p_branch_id)
 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_ADMIN_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.terminal_tokens WHERE id::text=p_terminal_id AND location_id=p_branch_id AND platform='pc'
  AND status IN('active','used') AND revoked_at IS NULL AND (is_claimed OR claimed_at IS NOT NULL)) THEN RAISE EXCEPTION 'SYNC_TERMINAL_SCOPE_FORBIDDEN';END IF;
 -- Never convert a new protected/approved-rollout action into weaker legacy recovery.
 IF to_regclass('fin62_history_preparation.protected_shifts') IS NULL OR to_regclass('fin62_rollout_preparation.approvals') IS NULL OR to_regprocedure('public.pos_sync_financial_capability(text,text,text,uuid)') IS NULL
 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_FINANCIAL_STATE_UNKNOWN';END IF;
 -- Prevent protection/rollout activation changing admission while this short
 -- transaction applies the reviewed historical graph. No sales table locks.
 LOCK TABLE fin62_history_preparation.protected_shifts IN SHARE MODE NOWAIT;
 LOCK TABLE fin62_rollout_preparation.approvals IN SHARE MODE NOWAIT;
 EXECUTE 'SELECT EXISTS(SELECT 1 FROM fin62_history_preparation.protected_shifts WHERE shift_id=$1)' INTO protected USING sid;
 IF protected THEN RAISE EXCEPTION 'LEGACY_RECOVERY_FINANCIAL_REQUIRED';END IF;
 capability:=public.pos_sync_financial_capability(p_organization_id,p_branch_id,p_terminal_id,sid);
 IF capability->>'mode' IS DISTINCT FROM 'disabled' OR capability->>'shiftMode' IS DISTINCT FROM 'legacy' THEN RAISE EXCEPTION 'LEGACY_RECOVERY_FINANCIAL_REQUIRED';END IF;
 SELECT * INTO parent FROM public.shifts WHERE id=sid AND store_id=p_branch_id FOR UPDATE NOWAIT;
 IF NOT FOUND OR parent.terminal_id IS DISTINCT FROM p_terminal_id OR parent.status IS DISTINCT FROM 'OPEN' OR parent.state IS DISTINCT FROM 'ACTIVE' OR parent.closed_at IS NOT NULL
 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_CLOUD_CHANGED';END IF;
 current_graph:=pos_sync_private.shift_graph(sid);witness:=(payload->>'cloudGraphText')::jsonb;
 IF witness IS DISTINCT FROM current_graph OR EXISTS(SELECT 1 FROM jsonb_array_elements(current_graph) x WHERE x->>'table'<>'shifts' AND jsonb_array_length(x->'rows')<>0) OR
  EXISTS(SELECT 1 FROM pos_sync_private.shift_intent_receipts WHERE shift_id=sid) OR EXISTS(SELECT 1 FROM pos_sync_private.shift_author_receipts WHERE shift_id=sid) OR
  EXISTS(SELECT 1 FROM pos_sync_private.legacy_shift_recovery_receipts WHERE shift_id=sid)
 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_CLOUD_CHANGED';END IF;
 raw_graph:=(payload->>'localGraphText')::jsonb;
 IF jsonb_typeof(raw_graph) IS DISTINCT FROM 'array' OR jsonb_array_length(raw_graph)<>6 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_GRAPH_INVALID';END IF;
 FOR table_name IN SELECT unnest(ARRAY['shifts','shift_cash_counts','shift_reconciliations','shift_close_events','shift_notifications','shift_variance_alerts']) LOOP
  IF (SELECT count(*) FROM jsonb_array_elements(raw_graph) x WHERE x->>'table'=table_name)<>1 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_GRAPH_INVALID';END IF;
  SELECT x->'rows' INTO rows_json FROM jsonb_array_elements(raw_graph) x WHERE x->>'table'=table_name;
  IF jsonb_typeof(rows_json) IS DISTINCT FROM 'array' OR jsonb_array_length(rows_json)>2000 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_GRAPH_INVALID';END IF;
  SELECT array_agg(attname::text ORDER BY attname) INTO names FROM pg_attribute WHERE attrelid=to_regclass(format('public.%I',table_name)) AND attnum>0 AND NOT attisdropped;
  typed:='[]';
  FOR r IN SELECT value FROM jsonb_array_elements(rows_json) LOOP
   SELECT array_agg(key ORDER BY key) INTO provided FROM jsonb_object_keys(r) key;
   IF provided IS DISTINCT FROM names THEN RAISE EXCEPTION 'LEGACY_RECOVERY_GRAPH_INVALID';END IF;
   EXECUTE format('SELECT to_jsonb(jsonb_populate_record(NULL::public.%I,$1))',table_name) INTO r USING r;
   IF r->>'store_id' IS DISTINCT FROM p_branch_id OR (table_name<>'shifts' AND r->>'shift_id' IS DISTINCT FROM sid::text) OR
    (r?'terminal_id' AND r->>'terminal_id' IS DISTINCT FROM p_terminal_id) THEN RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';END IF;
   IF table_name<>'shifts' THEN
    EXECUTE format('SELECT count(*) FROM public.%I WHERE id=$1',table_name) INTO affected USING (r->>'id')::uuid;
    IF affected<>0 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_CHILD_EXISTS';END IF;
   END IF;
   typed:=typed||jsonb_build_array(r);
  END LOOP;
  graph:=graph||jsonb_build_array(jsonb_build_object('table',table_name,'rows',typed));
 END LOOP;
 PERFORM pos_sync_private.validate_graph(graph,p_branch_id,sid,true);
 IF jsonb_array_length(graph->1->'rows')<>1 OR graph->1->'rows'->0->>'kind' IS DISTINCT FROM 'ORIGINAL' OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(graph->3->'rows') e WHERE e->>'event' NOT IN('closing_started','cash_count_submitted','reconciled'))
 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_GRAPH_INVALID';END IF;
 FOR target_recon IN SELECT value FROM jsonb_array_elements(graph->2->'rows') LOOP
  PERFORM pos_sync_private.validate_target(graph->1->'rows'->0,target_recon);
 END LOOP;
 incoming:=jsonb_populate_record(NULL::public.shifts,graph->0->'rows'->0);
 IF (to_jsonb(incoming)-fields-ARRAY['row_version','updated_at']) IS DISTINCT FROM (to_jsonb(parent)-fields-ARRAY['row_version','updated_at'])
 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_OPEN_FACTS_CHANGED';END IF;
 -- This dedicated, current-admin-reviewed typed writer does not call or disable
 -- generic ORIGINAL-author helpers. Existing trigger/FIN62 protections still run.
 current_setting_branch:=current_setting('pos.branch_id',true);PERFORM set_config('pos.branch_id',p_branch_id,true);
 FOR part IN SELECT value FROM jsonb_array_elements(graph) WHERE value->>'table'<>'shifts' LOOP
  table_name:=part->>'table';
  EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_populate_recordset(NULL::public.%I,$1)',table_name,table_name) USING part->'rows';
 END LOOP;
 SELECT string_agg(format('%I=proposed.%I',field,field),',') INTO assignments FROM unnest(fields) field;
 -- Same existing typed-writer admission used by the normal shift routines,
 -- scoped only after this RPC's fresh administrator/scope/CAS/legacy checks.
 -- Do not modify or disable shifts_guard_client_writes or any FIN62 trigger.
 previous_shift_writer:=current_setting('pos.shift_fn',true);PERFORM set_config('pos.shift_fn','on',true);
 EXECUTE 'UPDATE public.shifts target SET '||assignments||' FROM jsonb_populate_record(NULL::public.shifts,$1) proposed WHERE target.id=$2 AND target.store_id=$3' USING to_jsonb(incoming),sid,p_branch_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 PERFORM set_config('pos.shift_fn',COALESCE(previous_shift_writer,''),true);
 IF affected<>1 THEN RAISE EXCEPTION 'LEGACY_RECOVERY_APPLY_UNCONFIRMED';END IF;
 PERFORM set_config('pos.branch_id',COALESCE(current_setting_branch,''),true);
 current_graph:=pos_sync_private.shift_graph(sid);PERFORM pos_sync_private.validate_graph(current_graph,p_branch_id,sid,true);
 token:=pos_sync_private.graph_token(current_graph);coverage:=pos_sync_private.request_coverage(graph,current_graph);
 INSERT INTO pos_sync_private.legacy_shift_recovery_receipts(recovery_id,organization_id,branch_id,terminal_id,shift_id,payload_hash,evidence_hash,cloud_witness_hash,
  payload_json,attestation,reviewer_id,reviewer_subject,reason,financial_verification,accepted_graph,accepted_token,coverage)
 VALUES(recovery,p_organization_id,p_branch_id,p_terminal_id,sid,hash,local_hash,witness_hash,p_payload_json,p_attestation,registered.author_id,registered.subject,payload->>'reason',
  'UNVERIFIED_HISTORICAL',current_graph,token,coverage);
 RETURN jsonb_build_object('version',1,'recovery_id',recovery,'payload_hash',hash,'evidence_hash',local_hash,'cloud_witness_hash',witness_hash,
  'branch_id',p_branch_id,'terminal_id',p_terminal_id,'shift_id',sid,'reviewer_id',registered.author_id,'key_id',registered.key_id,
  'accepted_graph_text',current_graph::text,'accepted_graph_hash',encode(sha256(convert_to(current_graph::text,'UTF8')),'hex'),
  'financial_verification','UNVERIFIED_HISTORICAL','provenance','ADMIN_REVIEWED_LEGACY','accepted_token',token,'current_token',token,'superseded',false,
  'coverage',coverage,'graph',jsonb_build_object('tables',current_graph,'graphToken',token,'closedAtRaw',current_graph->0->'rows'->0->'closed_at'));
END $fn$;
REVOKE ALL ON FUNCTION public.pos_sync_recover_legacy_closing(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_recover_legacy_closing(text,text,text,text,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
