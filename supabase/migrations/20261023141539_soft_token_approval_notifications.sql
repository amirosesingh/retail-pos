BEGIN;

-- Reuse the durable activity inbox. This trigger runs in the approval write's
-- transaction and also handles approved records uploaded by an offline till.
-- The separate immutable approval/audit rows are never disabled by preferences.
CREATE OR REPLACE FUNCTION public.notify_soft_token_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  settings jsonb;
  approver text;
  requester text;
BEGIN
  IF NEW.outcome <> 'approved' OR NEW.detail->>'credential_method' IS DISTINCT FROM 'totp'
     OR NULLIF(btrim(NEW.authorized_by), '') IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT notification_settings INTO settings FROM public.pos_settings WHERE id = 1;
  IF settings #> '{inApp,soft_token_approval}' = 'false'::jsonb THEN RETURN NEW; END IF;
  approver := COALESCE(NULLIF(NEW.detail->>'approved_by_name', ''), NEW.authorized_by);
  requester := COALESCE(NULLIF(NEW.detail->>'requested_by_name', ''), NEW.requested_by, 'A staff member');
  INSERT INTO public.activity_events (
    event_type, severity, title, message, actor_id, actor_name, actor_role,
    terminal_id, store_id, entity_type, entity_id, meta, client_event_id, created_at
  ) VALUES (
    'soft_token_approval', 'info', 'Your soft token was used for approval',
    requester || ' used an approval from ' || approver || ' for ' || replace(NEW.action_key, '_', ' ') || '.',
    NEW.authorized_by, approver, NEW.authorizer_role,
    NULLIF(NEW.terminal_id, ''), NULLIF(NEW.store_id, ''), 'authorization_log', NEW.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'audience_user_ids', jsonb_build_array(NEW.authorized_by),
      'credential_method', 'totp', 'approval_id', NEW.id,
      'approved_by', NEW.authorized_by, 'approved_by_name', approver,
      'requested_by', NEW.requested_by, 'requested_by_name', requester,
      'action_key', NEW.action_key, 'ticket_reference', NEW.detail->>'ticket_reference',
      'approval_status', 'approved'
    )),
    'soft-token-approval:' || NEW.id::text, NEW.created_at
  ) ON CONFLICT (client_event_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_soft_token_approval() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notify_soft_token_approval ON public.authorization_log;
CREATE TRIGGER notify_soft_token_approval AFTER INSERT ON public.authorization_log
FOR EACH ROW EXECUTE FUNCTION public.notify_soft_token_approval();

-- Apply the saved in-app preference to SQL-generated events as well as API
-- events. Keep the durable event and other delivery channels intact.
CREATE OR REPLACE FUNCTION public.apply_in_app_notification_preference()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE settings jsonb;
BEGIN
  SELECT notification_settings INTO settings FROM public.pos_settings WHERE id = 1;
  NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
    'in_app_disabled', COALESCE(settings->'inApp'->NEW.event_type = 'false'::jsonb, false));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apply_in_app_notification_preference() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS apply_in_app_notification_preference ON public.activity_events;
CREATE TRIGGER apply_in_app_notification_preference BEFORE INSERT ON public.activity_events
FOR EACH ROW EXECUTE FUNCTION public.apply_in_app_notification_preference();


COMMIT;
