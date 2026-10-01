-- A local authorization edit advances its row version before upload. If a
-- terminal and central database hold the same version, central is already the
-- accepted revision and must not be replaced by a later device timestamp.
CREATE OR REPLACE FUNCTION public.sync_apply_authorization_actions(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.authorization_actions
    (id,action_key,scope_type,scope_id,mode,allowed_roles,allowed_user_ids,requester_roles,requester_user_ids,authority_limits,extra_authority,absolute_ceilings,approval_timeout_minutes,escalation_after_minutes,escalation_roles,require_reason,threshold,is_enabled,row_version,updated_by,created_at,updated_at)
  SELECT id,action_key,scope_type,scope_id,mode,allowed_roles,allowed_user_ids,requester_roles,requester_user_ids,authority_limits,extra_authority,absolute_ceilings,approval_timeout_minutes,escalation_after_minutes,escalation_roles,require_reason,threshold,is_enabled,row_version,updated_by,created_at,updated_at
  FROM jsonb_populate_recordset(NULL::public.authorization_actions, COALESCE(p_rows,'[]'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    action_key=EXCLUDED.action_key,scope_type=EXCLUDED.scope_type,scope_id=EXCLUDED.scope_id,
    mode=EXCLUDED.mode,allowed_roles=EXCLUDED.allowed_roles,allowed_user_ids=EXCLUDED.allowed_user_ids,
    requester_roles=EXCLUDED.requester_roles,requester_user_ids=EXCLUDED.requester_user_ids,
    authority_limits=EXCLUDED.authority_limits,extra_authority=EXCLUDED.extra_authority,
    absolute_ceilings=EXCLUDED.absolute_ceilings,approval_timeout_minutes=EXCLUDED.approval_timeout_minutes,
    escalation_after_minutes=EXCLUDED.escalation_after_minutes,escalation_roles=EXCLUDED.escalation_roles,
    require_reason=EXCLUDED.require_reason,threshold=EXCLUDED.threshold,is_enabled=EXCLUDED.is_enabled,
    row_version=EXCLUDED.row_version,updated_by=EXCLUDED.updated_by,created_at=EXCLUDED.created_at,
    updated_at=EXCLUDED.updated_at
  WHERE EXCLUDED.row_version > public.authorization_actions.row_version;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_apply_authorization_actions(jsonb) FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
