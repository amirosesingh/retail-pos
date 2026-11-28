-- Prepare only. Install on an isolated project before enabling its relay gate.
CREATE SCHEMA IF NOT EXISTS private;

CREATE FUNCTION private.pos_named_approval_wake_owns_topic(p_topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $own$
  SELECT p_topic = 'pos-approval-wake:v1:' || auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.app_users AS person
      WHERE person.auth_user_id = auth.uid() AND person.is_active
        AND lower(person.email) NOT LIKE 'terminal.%@pos.local'
    )
$own$;
REVOKE ALL ON FUNCTION private.pos_named_approval_wake_owns_topic(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.pos_named_approval_wake_owns_topic(text) TO authenticated;

CREATE POLICY pos_named_approval_wake_read ON realtime.messages FOR SELECT TO authenticated
USING (extension = 'broadcast' AND topic = (SELECT realtime.topic()) AND
       private.pos_named_approval_wake_owns_topic((SELECT realtime.topic())));
CREATE POLICY pos_named_approval_wake_read_scope ON realtime.messages AS RESTRICTIVE FOR SELECT TO authenticated
USING ((coalesce((SELECT realtime.topic()), '') NOT LIKE 'pos-approval-wake:%' AND topic NOT LIKE 'pos-approval-wake:%') OR
       (extension = 'broadcast' AND topic = (SELECT realtime.topic()) AND
        private.pos_named_approval_wake_owns_topic((SELECT realtime.topic()))));
CREATE POLICY pos_named_approval_wake_no_anon ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon
USING (coalesce((SELECT realtime.topic()), '') NOT LIKE 'pos-approval-wake:%' AND topic NOT LIKE 'pos-approval-wake:%');
CREATE POLICY pos_named_approval_wake_server_only ON realtime.messages AS RESTRICTIVE FOR INSERT TO authenticated, anon
WITH CHECK (coalesce((SELECT realtime.topic()), '') NOT LIKE 'pos-approval-wake:%' AND topic NOT LIKE 'pos-approval-wake:%');

CREATE FUNCTION public.pos_send_named_approval_wake_v1(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $send$
DECLARE
  v_request public.authorization_requests%ROWTYPE;
  v_recipient uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'POS_NAMED_APPROVAL_WAKE_FORBIDDEN';
  END IF;

  SELECT request.* INTO v_request FROM public.authorization_requests AS request
  WHERE request.id = p_request_id;
  IF NOT FOUND OR nullif(v_request.store_id, '') IS NULL
     OR v_request.approval_route->>'ruleScopeType' IS DISTINCT FROM 'global'
     OR jsonb_typeof(v_request.approval_route->'primaryUserIds') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_request.approval_route->'primaryApprovers') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_request.approval_route->'primaryUserIds') > 50 THEN
    RETURN;
  END IF;

  FOR v_recipient IN
    SELECT DISTINCT person.auth_user_id
    FROM public.app_users AS person
    JOIN public.authorization_actions AS rule ON rule.action_key = v_request.action_key
      AND rule.scope_type = 'global' AND rule.scope_id = ''
    WHERE person.is_active AND person.auth_user_id IS NOT NULL
      AND lower(person.email) NOT LIKE 'terminal.%@pos.local'
      AND lower(person.user_id) <> lower(v_request.requested_by)
      AND lower(coalesce(person.store_id, '')) <> lower(v_request.store_id)
      AND v_request.approval_route->'primaryUserIds' ? lower(person.user_id)
      AND v_request.approval_route->'primaryApprovers' @> jsonb_build_array(jsonb_build_object('id', person.user_id))
      AND rule.is_enabled AND rule.mode IN ('request', 'either')
      AND lower(person.user_id) = ANY (SELECT lower(id) FROM unnest(rule.allowed_user_ids) AS named(id))
      AND '!' || lower(person.user_id) <> ALL (SELECT lower(id) FROM unnest(rule.allowed_user_ids) AS named(id))
      AND (v_request.action_key = 'cross_group_transfer_approval' OR NOT EXISTS (
        SELECT 1 FROM public.authorization_actions AS branch_rule
        WHERE branch_rule.action_key = v_request.action_key
          AND branch_rule.scope_type = 'branch' AND branch_rule.scope_id = v_request.store_id
      ))
      AND (person.permissions->'approval_scope:configured' IS DISTINCT FROM 'true'::jsonb OR (
        coalesce(person.store_id, '') = '' AND (
          person.permissions->'approval_scope:all' = 'true'::jsonb OR EXISTS (
            SELECT 1 FROM jsonb_each(person.permissions) AS scope(key, value)
            WHERE lower(scope.key) = 'approval_scope:branch:' || lower(v_request.store_id) AND scope.value = 'true'::jsonb
          )
        )
      ))
  LOOP
    PERFORM realtime.send('{}'::jsonb, 'approval_changed', 'pos-approval-wake:v1:' || v_recipient::text, true);
  END LOOP;
END
$send$;
REVOKE ALL ON FUNCTION public.pos_send_named_approval_wake_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_send_named_approval_wake_v1(uuid) TO service_role;
