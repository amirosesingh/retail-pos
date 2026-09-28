BEGIN;

-- An obsolete eight-argument overload was winning PostgREST's RPC resolution
-- and rejected service-owned approval writes. Keep exactly one canonical
-- signature and record every successful override in all three history views.
DROP FUNCTION IF EXISTS public.log_manager_override(text,text,text,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.log_manager_override(text,text,text,text,text,text,text,text,text);

CREATE OR REPLACE FUNCTION public.log_manager_override(
  _action text,
  _rule_key text DEFAULT NULL,
  _requested_by text DEFAULT NULL,
  _approved_by text DEFAULT NULL,
  _approved_role text DEFAULT NULL,
  _store_id text DEFAULT NULL,
  _terminal_id text DEFAULT NULL,
  _detail text DEFAULT NULL,
  _outcome text DEFAULT 'approved',
  _mode_used text DEFAULT 'admin_auto'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  new_id uuid := gen_random_uuid();
  clean_action text := btrim(COALESCE(_action, ''));
  clean_outcome text := COALESCE(NULLIF(btrim(_outcome), ''), 'approved');
  clean_mode text := COALESCE(NULLIF(btrim(_mode_used), ''), 'admin_auto');
  audit_detail jsonb;
BEGIN
  IF clean_action = '' THEN
    RAISE EXCEPTION 'ACTION_REQUIRED: an override needs an action' USING ERRCODE = '22023';
  END IF;
  IF clean_mode NOT IN ('pin', 'request', 'admin_auto', 'offline_pin') THEN
    RAISE EXCEPTION 'OVERRIDE_MODE_INVALID' USING ERRCODE = '22023';
  END IF;
  audit_detail := jsonb_strip_nulls(jsonb_build_object(
    'rule_key', _rule_key,
    'requested_by', _requested_by,
    'approved_by', _approved_by,
    'approved_role', _approved_role,
    'store_id', _store_id,
    'terminal_id', _terminal_id,
    'outcome', clean_outcome,
    'mode_used', clean_mode,
    'detail', left(COALESCE(_detail, ''), 400)));

  INSERT INTO public.authorization_log(
    id, action_key, mode_used, requested_by, authorized_by, authorizer_role,
    store_id, terminal_id, outcome, detail)
  VALUES (
    new_id, clean_action, clean_mode, _requested_by, _approved_by, _approved_role,
    COALESCE(_store_id, ''), COALESCE(_terminal_id, ''), clean_outcome, audit_detail);

  INSERT INTO public.audit_logs(
    action_category, action_name, target_module, user_id, user_name, action,
    entity, details, store_id)
  VALUES (
    'override', clean_action, 'pos', _approved_by, _approved_by, clean_action,
    COALESCE(_rule_key, clean_action), audit_detail,
    NULLIF(btrim(COALESCE(_store_id, '')), ''));

  INSERT INTO public.system_audit_logs(
    actor_id, actor_name, actor_role, action_type, entity_affected, entity_id,
    new_value, terminal_id, store_id, note)
  VALUES (
    _approved_by, _approved_by, _approved_role,
    'authorization.override.' || clean_outcome,
    'authorization_log', new_id::text, audit_detail,
    NULLIF(btrim(COALESCE(_terminal_id, '')), ''),
    NULLIF(btrim(COALESCE(_store_id, '')), ''),
    left(COALESCE(_detail, ''), 400));

  RETURN new_id;
END $$;

REVOKE ALL ON FUNCTION public.log_manager_override(text,text,text,text,text,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_manager_override(text,text,text,text,text,text,text,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.verify_manager_pin(
  p_user_id text,
  p_pin text,
  p_action text DEFAULT NULL,
  p_rule_key text DEFAULT NULL,
  p_requested_by text DEFAULT NULL,
  p_store_id text DEFAULT NULL,
  p_terminal_id text DEFAULT NULL,
  p_detail text DEFAULT NULL
)
RETURNS TABLE(user_id text, full_name text, role public.app_role)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp' AS $$
DECLARE u public.app_users%ROWTYPE;
BEGIN
  SELECT * INTO u FROM public.app_users
   WHERE lower(app_users.user_id) = lower(trim(p_user_id)) AND is_active = true
   LIMIT 1;
  IF u.id IS NULL OR NOT (
    u.role IN ('admin','manager')
    OR COALESCE((u.permissions ->> 'can_access_pos_settings')::boolean, false)
    OR COALESCE((u.permissions ->> 'can_manage_staff')::boolean, false)) THEN
    RETURN;
  END IF;
  IF u.pin_hash = '' OR u.pin_hash <> extensions.crypt(p_pin::text, u.pin_hash::text) THEN
    RETURN;
  END IF;
  IF COALESCE(btrim(p_action), '') <> '' THEN
    PERFORM public.log_manager_override(
      p_action, p_rule_key, p_requested_by, u.user_id::text, u.role::text,
      p_store_id, p_terminal_id, p_detail, 'approved', 'pin');
  END IF;
  RETURN QUERY SELECT u.user_id::text, u.full_name::text, u.role;
END $$;

REVOKE ALL ON FUNCTION public.verify_manager_pin(text,text,text,text,text,text,text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_manager_pin(text,text,text,text,text,text,text,text)
  TO authenticated, service_role;

COMMIT;
