-- Prepared for an isolated project. Requires private Realtime Broadcast and
-- the exact enrolled-terminal relay gate. Polling remains the recovery path.
CREATE SCHEMA IF NOT EXISTS private;

CREATE POLICY pos_pin_approval_wake_receive ON realtime.messages FOR SELECT TO anon
USING (extension = 'broadcast'
  AND topic = (SELECT realtime.topic())
  AND topic LIKE 'pos-pin-approval-wake:v1:%'
  AND topic = (SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'pos_pin_approval_wake_topic'));

CREATE POLICY pos_pin_approval_wake_anon_scope ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon
USING (CASE
  WHEN (SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'pos_pin_approval_wake_topic') IS NOT NULL
  THEN extension = 'broadcast'
    AND topic = (SELECT realtime.topic())
    AND topic LIKE 'pos-pin-approval-wake:v1:%'
    AND topic = (SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'pos_pin_approval_wake_topic')
  ELSE coalesce((SELECT realtime.topic()), '') NOT LIKE 'pos-pin-approval-wake:%'
    AND topic NOT LIKE 'pos-pin-approval-wake:%'
END);

CREATE POLICY pos_pin_approval_wake_staff_scope ON realtime.messages AS RESTRICTIVE FOR SELECT TO authenticated
USING (coalesce((SELECT realtime.topic()), '') NOT LIKE 'pos-pin-approval-wake:%'
  AND topic NOT LIKE 'pos-pin-approval-wake:%');

CREATE POLICY pos_pin_approval_wake_server_send ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon, authenticated
WITH CHECK (coalesce((SELECT realtime.topic()), '') NOT LIKE 'pos-pin-approval-wake:%'
  AND topic NOT LIKE 'pos-pin-approval-wake:%'
  AND (SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'pos_pin_approval_wake_topic') IS NULL);

CREATE FUNCTION private.pos_pin_approval_emit_v1(p_store text, p_users text[], p_event text)
RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog
AS $emit$
DECLARE
  v_user text;
  v_branch text := lower(btrim(p_store));
BEGIN
  IF coalesce(v_branch, '') = '' OR position(chr(31) in v_branch) > 0 THEN RETURN; END IF;
  FOR v_user IN
    SELECT DISTINCT lower(btrim(person.user_id))
    FROM public.app_users AS person
    JOIN unnest(p_users) AS recipient(id) ON lower(person.user_id) = lower(recipient.id)
    WHERE person.is_active AND lower(person.store_id) = v_branch
      AND lower(coalesce(person.email, '')) NOT LIKE 'terminal.%@pos.local'
      AND btrim(person.user_id) <> '' AND position(chr(31) in person.user_id) = 0
  LOOP
    PERFORM realtime.send('{}'::jsonb, p_event,
      'pos-pin-approval-wake:v1:' ||
      encode(sha256(convert_to(v_branch || chr(31) || v_user, 'UTF8')), 'hex'), true);
  END LOOP;
END
$emit$;
REVOKE ALL ON FUNCTION private.pos_pin_approval_emit_v1(text,text[],text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.pos_pin_approval_queue_wake_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $queue$
DECLARE
  v_users text[];
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.status, NEW.consumed_at) IS NOT DISTINCT FROM (OLD.status, OLD.consumed_at) THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(person->>'id') INTO v_users
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.approval_route->'primaryApprovers') = 'array'
    THEN NEW.approval_route->'primaryApprovers' ELSE '[]'::jsonb END) AS person;
  PERFORM private.pos_pin_approval_emit_v1(NEW.store_id, array_append(v_users, NEW.requested_by), 'approval_changed');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'POS approval queue wake unavailable [%]', SQLSTATE;
  RETURN NULL;
END
$queue$;
REVOKE ALL ON FUNCTION private.pos_pin_approval_queue_wake_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER pos_pin_approval_queue_wake AFTER INSERT OR UPDATE OF status, consumed_at
ON public.authorization_requests FOR EACH ROW EXECUTE FUNCTION private.pos_pin_approval_queue_wake_v1();

CREATE FUNCTION private.pos_pin_approval_activity_wake_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $activity$
DECLARE
  v_users text[];
  v_audience jsonb;
  v_requester text;
BEGIN
  IF NEW.entity_type IS DISTINCT FROM 'authorization_request' OR coalesce(NEW.event_type, '') NOT IN
    ('approval_requested', 'approval_granted', 'approval_rejected', 'approval_expired')
    OR NEW.meta->'in_app_disabled' = 'true'::jsonb THEN RETURN NULL; END IF;
  v_audience := CASE WHEN jsonb_typeof(NEW.meta->'notification_routes') = 'object'
    THEN NEW.meta->'notification_routes'->'app' ELSE NEW.meta->'audience_user_ids' END;
  SELECT array_agg(id) INTO v_users
  FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_audience) = 'array' THEN v_audience ELSE '[]'::jsonb END) AS id;
  IF coalesce(NEW.terminal_id, '') <> '' AND
     (NEW.meta->'notification_routes'->'terminalApp') ? lower(NEW.terminal_id) AND
     NEW.entity_id ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' THEN
    SELECT request.requested_by INTO v_requester
    FROM public.authorization_requests AS request
    WHERE request.id = NEW.entity_id::uuid AND request.store_id = NEW.store_id;
    v_users := array_append(v_users, v_requester);
  END IF;
  PERFORM private.pos_pin_approval_emit_v1(NEW.store_id, v_users, 'approval_activity_changed');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'POS approval activity wake unavailable [%]', SQLSTATE;
  RETURN NULL;
END
$activity$;
REVOKE ALL ON FUNCTION private.pos_pin_approval_activity_wake_v1() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER pos_pin_approval_activity_wake AFTER INSERT ON public.activity_events
FOR EACH ROW EXECUTE FUNCTION private.pos_pin_approval_activity_wake_v1();
