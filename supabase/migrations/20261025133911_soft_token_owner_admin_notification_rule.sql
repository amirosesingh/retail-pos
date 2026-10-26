BEGIN;

-- Preserve immutable approval records. The event's privacy ceiling is its
-- verified token owner plus active administrators; saved rules select delivery
-- channels and any narrower audience. Never store the token/PIN itself.
CREATE OR REPLACE FUNCTION public.notify_soft_token_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE
  settings jsonb;
  approver text;
  requester text;
  recipients jsonb;
  reference text;
BEGIN
  IF NEW.outcome <> 'approved' OR NEW.detail->>'credential_method' IS DISTINCT FROM 'totp'
     OR NULLIF(btrim(NEW.authorized_by), '') IS NULL THEN RETURN NEW; END IF;
  SELECT notification_settings INTO settings FROM public.pos_settings WHERE id=1;
  IF jsonb_typeof(settings->'rules') IS DISTINCT FROM 'array'
     AND settings #> '{inApp,soft_token_approval}' = 'false'::jsonb THEN RETURN NEW; END IF;
  approver := COALESCE(NULLIF(NEW.detail->>'approved_by_name', ''), NEW.authorized_by);
  requester := COALESCE(NULLIF(NEW.detail->>'requested_by_name', ''), NEW.requested_by, 'A staff member');
  reference := NULLIF(btrim(NEW.detail->>'ticket_reference'), '');
  SELECT COALESCE(jsonb_agg(recipient ORDER BY recipient), '[]'::jsonb) INTO recipients FROM (
    SELECT NEW.authorized_by::text AS recipient
    UNION
    SELECT a.user_id::text FROM public.app_users a
    WHERE a.is_active AND (a.role::text='admin' OR a.role_slug='admin') AND NULLIF(btrim(a.user_id),'') IS NOT NULL
  ) selected;
  INSERT INTO public.activity_events (
    event_type,severity,title,message,actor_id,actor_name,actor_role,
    terminal_id,store_id,entity_type,entity_id,meta,client_event_id,created_at
  ) VALUES (
    'soft_token_approval','info','Soft token used for approval',
    requester || ' used an approval from ' || approver || ' for ' || replace(NEW.action_key,'_',' ') ||
      CASE WHEN reference IS NOT NULL THEN ' · Bill ' || reference ELSE '' END || '.',
    NEW.authorized_by,approver,NEW.authorizer_role,NULLIF(NEW.terminal_id,''),NULLIF(NEW.store_id,''),
    'authorization_log',NEW.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'audience_user_ids',recipients,'credential_method','totp','approval_id',NEW.id,
      'approved_by',NEW.authorized_by,'approved_by_name',approver,
      'requested_by',NEW.requested_by,'requested_by_name',requester,
      'action_key',NEW.action_key,'ticket_reference',reference,'approval_status','approved'
    )), 'soft-token-approval:' || NEW.id::text,NEW.created_at
  ) ON CONFLICT (client_event_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notify_soft_token_approval() FROM PUBLIC,anon,authenticated;

-- Add only the missing event rule to already activated tables. Do not switch
-- legacy sites into rules mode or replace an operator's existing token rule.
UPDATE public.pos_settings s
SET notification_settings=jsonb_set(s.notification_settings,'{rules}',
  (s.notification_settings->'rules') || jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid()::text,'name','Soft token used — owner and administrators','enabled',true,
    'event','soft_token_approval','branches','[]'::jsonb,'actorUsers','[]'::jsonb,'actorRoles','[]'::jsonb,
    'severities','[]'::jsonb,'minAmount',NULL,'maxAmount',NULL,'audience','original',
    'users','[]'::jsonb,'roles','[]'::jsonb,'channels','["app"]'::jsonb,'phones','[]'::jsonb,
    'phoneUsers','{}'::jsonb,'template',E'{{title}}\n{{message}}\n{{branch}}',
    'quietFrom','','quietTo','','timeZone','UTC'
  )))
WHERE s.id=1 AND jsonb_typeof(s.notification_settings->'rules')='array'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s.notification_settings->'rules') r
    WHERE r->>'event'='soft_token_approval');

NOTIFY pgrst, 'reload schema';
COMMIT;
