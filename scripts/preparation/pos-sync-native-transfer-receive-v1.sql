-- Prepare against the reviewed warehouse lifecycle. Web callers keep their
-- existing authenticated path. The relay uses a transaction-bound receiver.
BEGIN;

CREATE OR REPLACE FUNCTION private.native_transfer_receiver_allowed(p_transfer uuid,p_stage text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
RETURN auth.role()='service_role'
  AND current_setting('pos.native_receiver_transfer',true)=p_transfer::text
  AND current_setting('pos.native_receiver_stage',true)=p_stage
  AND EXISTS (SELECT 1 FROM public.app_users
    WHERE id::text=current_setting('pos.native_receiver_actor',true) AND is_active);
REVOKE ALL ON FUNCTION private.native_transfer_receiver_allowed(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

DO $guard$
DECLARE
  v_stage text;
  v_name text;
  v_definition text;
  v_anchor constant text:='IF NOT public.is_staff(auth.uid()) THEN';
  v_replacement text;
BEGIN
  FOR v_stage,v_name IN VALUES ('receive','private.stock_transfer_receive(uuid,text,boolean,jsonb)'),
    ('verify','private.stock_transfer_verify(uuid,text,jsonb,text)')
  LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_name)) INTO v_definition;
    v_replacement:=format('IF NOT public.is_staff(auth.uid()) AND NOT coalesce(private.native_transfer_receiver_allowed(p_transfer_id,%L),false) THEN',v_stage);
    IF v_definition IS NULL THEN
      RAISE EXCEPTION 'Expected canonical warehouse writer missing: %',v_stage;
    ELSIF strpos(v_definition,v_replacement)>0 THEN
      CONTINUE;
    ELSIF length(v_definition)-length(replace(v_definition,v_anchor,''))<>length(v_anchor) THEN
      RAISE EXCEPTION 'Expected canonical warehouse actor check missing or ambiguous: %',v_stage;
    END IF;
    EXECUTE replace(v_definition,v_anchor,v_replacement);
  END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION public.stock_transfer_receive_for_staff(
  p_transfer_id uuid,p_staff_user_id text,p_bound_store_id text,p_stage text,
  p_lines jsonb DEFAULT NULL,p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $receive$
DECLARE
  v_actor public.app_users;
  v_transfer public.stock_transfers;
  v_actor_name text;
  v_prior_transfer text:=current_setting('pos.native_receiver_transfer',true);
  v_prior_stage text:=current_setting('pos.native_receiver_stage',true);
  v_prior_actor text:=current_setting('pos.native_receiver_actor',true);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Verified native receiver session required' USING ERRCODE='insufficient_privilege';
  END IF;
  IF p_stage IS NULL OR p_stage NOT IN ('receive','verify') THEN
    RAISE EXCEPTION 'Invalid warehouse receipt stage' USING ERRCODE='invalid_parameter_value';
  END IF;
  SELECT * INTO v_actor FROM public.app_users WHERE user_id=p_staff_user_id FOR SHARE;
  IF NOT FOUND OR v_actor.is_active IS DISTINCT FROM true OR NOT (
    coalesce(v_actor.role::text,'')='admin' OR coalesce(v_actor.role_slug,'')='admin' OR
    (coalesce(v_actor.permissions->'can_receive_transfer'='true'::jsonb,false) AND EXISTS (
      SELECT 1 FROM unnest(ARRAY['requests','transfers','approvals','verifications']) AS allowed(page)
      WHERE v_actor.permissions->('page:'||allowed.page) IS DISTINCT FROM 'false'::jsonb
    ))
  ) THEN
    RAISE EXCEPTION 'Active transfer receipt permission required' USING ERRCODE='insufficient_privilege';
  END IF;
  SELECT * INTO v_transfer FROM public.stock_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND_OR_UNAVAILABLE'; END IF;
  IF (nullif(p_bound_store_id,'') IS NOT NULL AND p_bound_store_id<>v_transfer.to_store_id)
    OR (v_actor.store_id IS NOT NULL AND v_actor.store_id<>v_transfer.to_store_id)
    OR (nullif(p_bound_store_id,'') IS NULL AND v_actor.store_id IS NULL
      AND coalesce(v_actor.role::text,'') NOT IN ('admin','manager') AND coalesce(v_actor.role_slug,'') NOT IN ('admin','supervisor')) THEN
    RAISE EXCEPTION 'You cannot receive or verify transfers for this destination location' USING ERRCODE='insufficient_privilege';
  END IF;
  v_actor_name:=coalesce(nullif(btrim(v_actor.full_name),''),v_actor.user_id);
  PERFORM set_config('pos.native_receiver_transfer',v_transfer.id::text,true);
  PERFORM set_config('pos.native_receiver_stage',p_stage,true);
  PERFORM set_config('pos.native_receiver_actor',v_actor.id::text,true);
  IF p_stage='receive' THEN
    PERFORM private.stock_transfer_receive(v_transfer.id,v_actor_name,false,p_lines);
  ELSE
    PERFORM private.stock_transfer_verify(v_transfer.id,v_actor_name,p_lines,p_reason);
  END IF;
  PERFORM set_config('pos.native_receiver_transfer',coalesce(v_prior_transfer,''),true);
  PERFORM set_config('pos.native_receiver_stage',coalesce(v_prior_stage,''),true);
  PERFORM set_config('pos.native_receiver_actor',coalesce(v_prior_actor,''),true);
END;
$receive$;

REVOKE ALL ON FUNCTION public.stock_transfer_receive_for_staff(uuid,text,text,text,jsonb,text)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.stock_transfer_receive_for_staff(uuid,text,text,text,jsonb,text) TO service_role;
NOTIFY pgrst,'reload schema';

COMMIT;
