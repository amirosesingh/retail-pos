-- FIN62 PREPARATION ONLY / NOT FINAL / DO NOT APPLY TO OPERATOR DATABASE.
-- Accepted OPEN origin foundation. Does NOT verify HTTP device/user proofs;
-- the hosting layer must supply its existing verified terminal admission.
-- Existing aggregate routines/permissions are delegated unchanged. No backfill.
CREATE SCHEMA fin62_origin_preparation;
REVOKE ALL ON SCHEMA fin62_origin_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE fin62_origin_preparation.active_context(
 backend_pid integer NOT NULL,capture_xid xid8 NOT NULL,nonce uuid PRIMARY KEY,
 organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text NOT NULL,shift_id uuid NOT NULL,
 UNIQUE(backend_pid,capture_xid)
);
CREATE TABLE fin62_origin_preparation.births(nonce uuid PRIMARY KEY,shift_id uuid NOT NULL,basis_id uuid NOT NULL REFERENCES fin62_cloud_preparation.bases(id));
CREATE TABLE fin62_origin_preparation.origins(
 id uuid PRIMARY KEY,organization_id text NOT NULL,branch_id text NOT NULL,terminal_id text NOT NULL,
 local_aggregate_id uuid NOT NULL,row_hash text NOT NULL CHECK(row_hash~'^[a-f0-9]{64}$'),
 shift_id uuid NOT NULL UNIQUE,batch_id uuid NOT NULL,operations_hash text NOT NULL,
 basis_id uuid NOT NULL REFERENCES fin62_cloud_preparation.bases(id),upload_result jsonb NOT NULL,
 UNIQUE(organization_id,terminal_id,local_aggregate_id)
);
ALTER TABLE fin62_origin_preparation.active_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin62_origin_preparation.births ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin62_origin_preparation.origins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fin62_origin_preparation FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION fin62_origin_preparation.immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FIN62_OPEN_ORIGIN_IMMUTABLE';END $$;
REVOKE ALL ON FUNCTION fin62_origin_preparation.immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER births_immutable BEFORE UPDATE OR DELETE ON fin62_origin_preparation.births FOR EACH ROW EXECUTE FUNCTION fin62_origin_preparation.immutable();
CREATE TRIGGER origins_immutable BEFORE UPDATE OR DELETE ON fin62_origin_preparation.origins FOR EACH ROW EXECUTE FUNCTION fin62_origin_preparation.immutable();
CREATE FUNCTION fin62_origin_preparation.capture_birth() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE context fin62_origin_preparation.active_context%ROWTYPE;basis jsonb;
BEGIN
 SELECT * INTO context FROM fin62_origin_preparation.active_context WHERE backend_pid=pg_backend_pid() AND capture_xid=pg_current_xact_id() AND shift_id=NEW.id;
 IF NOT FOUND THEN RETURN NULL;END IF; -- All old/unwrapped insertion paths stay unchanged.
 IF NEW.store_id IS DISTINCT FROM context.branch_id OR NEW.terminal_id IS DISTINCT FROM context.terminal_id OR NEW.status IS DISTINCT FROM 'OPEN' OR
  NEW.closed_at IS NOT NULL OR coalesce(NEW.state,'ACTIVE')<>'ACTIVE' THEN RAISE EXCEPTION 'FIN62_OPEN_BIRTH_INVALID';END IF;
 IF EXISTS(SELECT 1 FROM public.sales s WHERE s.shift_id=NEW.id::text AND s.store_id=context.branch_id) THEN RAISE EXCEPTION 'FIN62_OPEN_BIRTH_NOT_EMPTY';END IF;
 basis:=public.prototype_fin62_create_basis(context.organization_id,context.branch_id,context.terminal_id,NEW.id);
 IF jsonb_array_length(basis->'basis'->'inputs')<>0 THEN RAISE EXCEPTION 'FIN62_OPEN_BIRTH_NOT_EMPTY';END IF;
 INSERT INTO fin62_origin_preparation.births(nonce,shift_id,basis_id) VALUES(context.nonce,NEW.id,(basis->>'basisId')::uuid);
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION fin62_origin_preparation.capture_birth() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prototype_fin62_capture_open_birth AFTER INSERT ON public.shifts FOR EACH ROW EXECUTE FUNCTION fin62_origin_preparation.capture_birth();
CREATE FUNCTION public.prototype_fin62_push_open_origin(
 p_batch uuid,p_org text,p_branch text,p_terminal text,p_local_aggregate uuid,p_opening_json text,p_row_hash text,p_operations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE row_value jsonb;shift uuid;digest text;v_nonce uuid;basis uuid;result jsonb;prior fin62_origin_preparation.origins%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'FIN62_SERVICE_REQUIRED';END IF;
 PERFORM public.pos_sync_validate_scope(p_org,p_branch,p_terminal);
 IF p_batch IS NULL OR p_local_aggregate IS NULL OR p_opening_json IS NULL OR octet_length(p_opening_json)>256*1024 OR
  p_row_hash IS NULL OR p_row_hash!~'^[a-f0-9]{64}$' OR encode(sha256(convert_to(p_opening_json,'UTF8')),'hex')<>p_row_hash
 THEN RAISE EXCEPTION 'FIN62_OPEN_ORIGIN_INPUT_INVALID';END IF;
 PERFORM fin62_preparation.math_unique_json(p_opening_json::json);row_value:=p_opening_json::jsonb;
 IF octet_length(p_operations::text)>6*1024*1024 OR jsonb_typeof(p_operations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_operations)<>1 OR p_operations->0->>'table' IS DISTINCT FROM 'shifts' OR
  jsonb_typeof(p_operations->0->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_operations->0->'rows')<>1 OR
  p_operations->0->'rows'->0 IS DISTINCT FROM row_value OR coalesce((p_operations->0->>'deletePhase')::boolean,false) OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_operations->0->'changes','[]'::jsonb)) c WHERE upper(coalesce(c->>'operation','')) NOT IN('INSERT','I'))
 THEN RAISE EXCEPTION 'FIN62_OPEN_ORIGIN_OPERATIONS_INVALID';END IF;
 IF row_value->>'store_id' IS DISTINCT FROM p_branch OR row_value->>'terminal_id' IS DISTINCT FROM p_terminal OR
  row_value->>'status' IS DISTINCT FROM 'OPEN' OR coalesce(row_value->>'state','ACTIVE')<>'ACTIVE' OR row_value->>'closed_at' IS NOT NULL
 THEN RAISE EXCEPTION 'FIN62_OPEN_ORIGIN_INPUT_INVALID';END IF;
 shift:=(row_value->>'id')::uuid;IF shift IS NULL THEN RAISE EXCEPTION 'FIN62_OPEN_ORIGIN_INPUT_INVALID';END IF;
 digest:=encode(sha256(convert_to(p_operations::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('fin62-open-origin:'||shift::text,0));
 SELECT * INTO prior FROM fin62_origin_preparation.origins WHERE organization_id=p_org AND terminal_id=p_terminal AND local_aggregate_id=p_local_aggregate;
 IF FOUND THEN
  IF ROW(prior.branch_id,prior.shift_id,prior.row_hash,prior.batch_id,prior.operations_hash) IS DISTINCT FROM ROW(p_branch,shift,p_row_hash,p_batch,digest)
  THEN RAISE EXCEPTION 'FIN62_OPEN_ORIGIN_CONFLICT';END IF;
  RETURN prior.upload_result||jsonb_build_object('openingOrigin',jsonb_build_object('localAggregateId',p_local_aggregate,'rowHash',p_row_hash),'birthBasisId',prior.basis_id,'originReplayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.shifts WHERE id=shift) OR EXISTS(SELECT 1 FROM fin62_origin_preparation.origins WHERE shift_id=shift) THEN RAISE EXCEPTION 'FIN62_OPEN_ORIGIN_NOT_NEW';END IF;
 v_nonce:=gen_random_uuid();
 INSERT INTO fin62_origin_preparation.active_context VALUES(pg_backend_pid(),pg_current_xact_id(),v_nonce,p_org,p_branch,p_terminal,shift);
 result:=public.pos_sync_push_aggregate(p_batch,p_org,p_branch,p_terminal,p_operations);
 IF result->'ok' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'FIN62_OPEN_UPLOAD_NOT_ACKNOWLEDGED';END IF;
 SELECT basis_id INTO basis FROM fin62_origin_preparation.births WHERE births.nonce=v_nonce AND shift_id=shift;
 IF basis IS NULL OR NOT EXISTS(SELECT 1 FROM public.shifts s WHERE s.id=shift AND s.store_id=p_branch AND s.status='OPEN' AND s.closed_at IS NULL) THEN RAISE EXCEPTION 'FIN62_OPEN_BIRTH_MISSING';END IF;
 INSERT INTO fin62_origin_preparation.origins VALUES(gen_random_uuid(),p_org,p_branch,p_terminal,p_local_aggregate,p_row_hash,shift,p_batch,digest,basis,result);
 DELETE FROM fin62_origin_preparation.active_context c WHERE c.nonce=v_nonce;
 RETURN result||jsonb_build_object('openingOrigin',jsonb_build_object('localAggregateId',p_local_aggregate,'rowHash',p_row_hash),'birthBasisId',basis,'originReplayed',false);
END $fn$;
REVOKE ALL ON FUNCTION public.prototype_fin62_push_open_origin(uuid,text,text,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prototype_fin62_push_open_origin(uuid,text,text,text,uuid,text,text,jsonb) TO service_role;
CREATE FUNCTION fin62_origin_preparation.resolve(p_org text,p_branch text,p_terminal text,p_shift uuid,p_origin jsonb)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $fn$
DECLARE basis uuid;
BEGIN
 IF jsonb_typeof(p_origin) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_origin))<>2 OR
  coalesce(p_origin->>'localAggregateId','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR coalesce(p_origin->>'rowHash','')!~'^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'FIN62_OPEN_ORIGIN_INPUT_INVALID';END IF;
 SELECT basis_id INTO basis FROM fin62_origin_preparation.origins WHERE organization_id=p_org AND branch_id=p_branch AND terminal_id=p_terminal AND shift_id=p_shift
  AND local_aggregate_id=(p_origin->>'localAggregateId')::uuid AND row_hash=p_origin->>'rowHash';
 IF basis IS NULL THEN RAISE EXCEPTION 'FIN62_OPEN_ORIGIN_UNPROVEN';END IF;RETURN basis;
END $fn$;
REVOKE ALL ON FUNCTION fin62_origin_preparation.resolve(text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
