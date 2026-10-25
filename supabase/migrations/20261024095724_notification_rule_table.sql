BEGIN;

-- Cloud delivery state is separate from immutable activity/audit records and
-- from operator-managed terminal configuration. No existing rule is activated.
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES public.activity_events(id) ON DELETE CASCADE,
  rule_id text NOT NULL, rule_name text NOT NULL, channel text NOT NULL CHECK(channel IN ('app','push','whatsapp')),
  recipient text NOT NULL, recipient_user_id text, message text NOT NULL DEFAULT '',
  status text NOT NULL CHECK(status IN ('available','queued','sending','sent','failed','unknown','skipped')),
  reason text NOT NULL DEFAULT '', next_attempt timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
  UNIQUE(event_id,channel,recipient)
);
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_deliveries FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.notification_deliveries TO service_role;
CREATE INDEX IF NOT EXISTS notification_delivery_due ON public.notification_deliveries(channel,next_attempt) WHERE status='queued';
CREATE INDEX IF NOT EXISTS notification_delivery_history ON public.notification_deliveries(created_at DESC,id);

CREATE OR REPLACE FUNCTION public.notification_rules_status() RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.notification_rules_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notification_rules_status() TO service_role;

CREATE OR REPLACE FUNCTION public.save_notification_rule_table(p_rules jsonb,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE current_settings jsonb;
BEGIN
  IF jsonb_typeof(p_rules)<>'array' OR jsonb_array_length(p_rules)>200 THEN RAISE EXCEPTION 'Invalid notification rules'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rules) r WHERE NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=r->>'timeZone')) THEN
    RAISE EXCEPTION 'Invalid notification time zone';
  END IF;
  SELECT notification_settings INTO current_settings FROM public.pos_settings WHERE id=1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company settings are not initialized'; END IF;
  IF COALESCE(current_settings->'rules','null'::jsonb) IS DISTINCT FROM COALESCE(p_expected,'null'::jsonb) THEN
    RAISE EXCEPTION 'Notification rules changed on another device. Reload before saving.';
  END IF;
  -- Preserve legacy data for rollback; retire its switches only after the owner
  -- explicitly saves the imported table. Audit events always remain recorded.
  UPDATE public.pos_settings SET notification_settings=COALESCE(current_settings,'{}') || jsonb_build_object('rules',p_rules,'rulesVersion',1,'inApp','{}'::jsonb) WHERE id=1;
  RETURN p_rules;
END $$;
REVOKE ALL ON FUNCTION public.save_notification_rule_table(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_notification_rule_table(jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.notification_rule_matches(r jsonb,e jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF r->>'enabled'<>'true' OR r->>'event'<>e->>'event_type' THEN RETURN false; END IF;
  IF jsonb_array_length(r->'branches')>0 AND NOT (r->'branches' ? COALESCE(e->>'store_id','')) THEN RETURN false; END IF;
  IF jsonb_array_length(r->'actorUsers')>0 AND NOT (r->'actorUsers' ? COALESCE(e->>'actor_id','')) THEN RETURN false; END IF;
  IF jsonb_array_length(r->'actorRoles')>0 AND NOT (r->'actorRoles' ? COALESCE(e->>'actor_role','')) THEN RETURN false; END IF;
  IF jsonb_array_length(r->'severities')>0 AND NOT (r->'severities' ? COALESCE(e->>'severity','info')) THEN RETURN false; END IF;
  IF r->>'minAmount' IS NOT NULL AND (e->>'amount' IS NULL OR (e->>'amount')::numeric < (r->>'minAmount')::numeric) THEN RETURN false; END IF;
  IF r->>'maxAmount' IS NOT NULL AND (e->>'amount' IS NULL OR (e->>'amount')::numeric > (r->>'maxAmount')::numeric) THEN RETURN false; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.notification_rule_matches(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notification_rule_matches(jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.notification_rule_recipients(r jsonb,e jsonb)
RETURNS SETOF text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT DISTINCT a.user_id::text FROM public.app_users a
  WHERE a.is_active AND a.user_id IS NOT NULL
    AND (COALESCE(e->>'store_id','')='' OR a.store_id IS NULL OR a.store_id::text=e->>'store_id' OR a.role::text='admin')
    AND (r->>'audience'='branch' OR (r->>'audience'='audit' AND (a.role::text='admin' OR a.permissions->>'can_view_audit_trail'='true'))
      OR (r->>'audience'='selected' AND (r->'users' ? a.user_id::text OR r->'roles' ? COALESCE(NULLIF(a.role_slug,''),a.role::text)))
      OR r->>'audience'='original')
    AND (COALESCE(e->'meta'->>'audience','')='' AND COALESCE(jsonb_array_length(e->'meta'->'audience_user_ids'),0)=0
          AND COALESCE(jsonb_array_length(e->'meta'->'audience_roles'),0)=0 AND COALESCE(e->'meta'->>'audience_terminal_id','')=''
      OR (COALESCE(e->'meta'->'audience_user_ids','[]') ? a.user_id::text OR COALESCE(e->'meta'->'audience_user_ids','[]') ? a.id::text
        OR COALESCE(e->'meta'->'audience_roles','[]') ? COALESCE(NULLIF(a.role_slug,''),a.role::text)
        OR e->'meta'->>'audience'=a.user_id::text))
    AND (r->>'audience'<>'original' OR COALESCE(e->'meta'->>'audience','')<>'' OR COALESCE(jsonb_array_length(e->'meta'->'audience_user_ids'),0)>0 OR COALESCE(jsonb_array_length(e->'meta'->'audience_roles'),0)>0)
$$;
REVOKE ALL ON FUNCTION public.notification_rule_recipients(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notification_rule_recipients(jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.notification_rule_due(r jsonb,at_time timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE local_time timestamp; from_time time; to_time time; zone text:=COALESCE(r->>'timeZone','UTC');
BEGIN
  IF COALESCE(r->>'quietFrom','')='' OR COALESCE(r->>'quietTo','')='' OR r->>'quietFrom'=r->>'quietTo' THEN RETURN at_time; END IF;
  local_time:=at_time AT TIME ZONE zone; from_time:=(r->>'quietFrom')::time; to_time:=(r->>'quietTo')::time;
  IF from_time<to_time AND local_time::time>=from_time AND local_time::time<to_time THEN RETURN (local_time::date+to_time) AT TIME ZONE zone; END IF;
  IF from_time>to_time THEN
    IF local_time::time>=from_time THEN RETURN ((local_time::date+1)+to_time) AT TIME ZONE zone; END IF;
    IF local_time::time<to_time THEN RETURN (local_time::date+to_time) AT TIME ZONE zone; END IF;
  END IF;
  RETURN at_time;
END $$;
REVOKE ALL ON FUNCTION public.notification_rule_due(jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notification_rule_due(jsonb,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.notification_rule_message(r jsonb,e jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE body text:=COALESCE(NULLIF(r->>'template',''),'{{title}}'||E'\n'||'{{message}}'); branch text;
BEGIN
  SELECT name INTO branch FROM public.stores WHERE id::text=e->>'store_id';
  RETURN replace(replace(replace(replace(replace(replace(replace(body,'{{title}}',COALESCE(e->>'title','')),'{{message}}',COALESCE(e->>'message','')),
    '{{cashier}}',COALESCE(e->>'actor_name','')),'{{role}}',COALESCE(e->>'actor_role','')),'{{branch}}',COALESCE(branch,e->>'store_id','')),
    '{{amount}}',COALESCE(e->>'amount','')),'{{time}}',COALESCE(e->>'created_at',''));
END $$;
REVOKE ALL ON FUNCTION public.notification_rule_message(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notification_rule_message(jsonb,jsonb) TO service_role;

-- Runs as the inserting service. No public security-definer API is introduced.
CREATE OR REPLACE FUNCTION public.apply_in_app_notification_preference()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE cfg jsonb; r jsonb; app_ids jsonb:='[]'; push_ids jsonb:='[]'; terminal_ids jsonb:='[]'; ids jsonb; original jsonb; messages jsonb:='{}'; uid text; body text;
BEGIN
  SELECT notification_settings INTO cfg FROM public.pos_settings WHERE id=1;
  IF jsonb_typeof(cfg->'rules')<>'array' THEN
    NEW.meta:=COALESCE(NEW.meta,'{}')||jsonb_build_object('in_app_disabled',COALESCE(cfg->'inApp'->NEW.event_type='false'::jsonb,false)); RETURN NEW;
  END IF;
  original:=COALESCE(NEW.meta,'{}') - 'notification_routes' - 'notification_original' - 'notification_messages';
  -- Retire legacy stock-team role lists; configured rules own operational
  -- recipients. Exact-user/terminal and approval audiences remain restricted.
  IF NEW.event_type IN ('stock_request_received','transfer_sent','transfer_received','po_finalised')
    AND original->>'audience' IN ('receiving_branch','sending_branch','branch_stock_team')
    AND COALESCE(jsonb_array_length(original->'audience_user_ids'),0)=0 AND COALESCE(original->>'audience_terminal_id','')='' THEN
    original:=original-'audience'-'audience_roles';
  END IF;
  NEW.meta:=original;
  FOR r IN SELECT value FROM jsonb_array_elements(cfg->'rules') LOOP
    IF public.notification_rule_matches(r,to_jsonb(NEW)) THEN
      SELECT COALESCE(jsonb_agg(recipient.value),'[]') INTO ids FROM public.notification_rule_recipients(r,to_jsonb(NEW)) recipient(value);
      IF r->'channels' ? 'app' THEN
        app_ids:=app_ids||ids; body:=public.notification_rule_message(r,to_jsonb(NEW));
        FOR uid IN SELECT jsonb_array_elements_text(ids) LOOP
          IF NOT messages ? uid THEN messages:=messages||jsonb_build_object(uid,body); END IF;
        END LOOP;
        IF r->>'audience'='original' AND COALESCE(original->>'audience_terminal_id','')<>'' THEN
          terminal_ids:=terminal_ids||jsonb_build_array(original->>'audience_terminal_id');
        END IF;
      END IF;
      IF r->'channels' ? 'push' THEN push_ids:=push_ids||ids; END IF;
    END IF;
  END LOOP;
  NEW.meta:=original||jsonb_build_object('notification_original',original,'notification_messages',messages,'notification_routes',jsonb_build_object('app',app_ids,'push',push_ids,'terminalApp',terminal_ids),
    'audience','configured_notification_rules','audience_user_ids',app_ids||push_ids,'audience_roles','[]'::jsonb,
    'audience_terminal_id',CASE WHEN jsonb_array_length(terminal_ids)>0 THEN original->>'audience_terminal_id' ELSE NULL END,
    'in_app_disabled',jsonb_array_length(app_ids)=0 AND jsonb_array_length(terminal_ids)=0);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  NEW.meta:=COALESCE(NEW.meta,'{}')||jsonb_build_object('audience','configured_notification_rules','audience_user_ids','[]'::jsonb,'audience_roles','[]'::jsonb,
    'in_app_disabled',true,'notification_routes',jsonb_build_object('app','[]'::jsonb,'push','[]'::jsonb),'notification_rule_error','Invalid notification rule configuration');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apply_in_app_notification_preference() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS apply_in_app_notification_preference ON public.activity_events;
CREATE TRIGGER apply_in_app_notification_preference BEFORE INSERT ON public.activity_events FOR EACH ROW EXECUTE FUNCTION public.apply_in_app_notification_preference();

CREATE OR REPLACE FUNCTION public.queue_notification_rule_deliveries()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE cfg jsonb; r jsonb; e jsonb; ch text; who text; body text; due timestamptz; private_event boolean; branch text; created_count int:=0;
BEGIN
  SELECT notification_settings INTO cfg FROM public.pos_settings WHERE id=1;
  IF jsonb_typeof(cfg->'rules')<>'array' THEN RETURN NEW; END IF;
  IF NEW.meta ? 'notification_rule_error' THEN
    INSERT INTO public.notification_deliveries(event_id,rule_id,rule_name,channel,recipient,status,reason) VALUES(NEW.id,'invalid','Invalid rule configuration','app','','failed',NEW.meta->>'notification_rule_error'); RETURN NEW;
  END IF;
  e:=to_jsonb(NEW)||jsonb_build_object('meta',COALESCE(NEW.meta->'notification_original','{}'));
  private_event:=COALESCE(e->'meta'->>'audience','')<>'' OR COALESCE(jsonb_array_length(e->'meta'->'audience_user_ids'),0)>0 OR COALESCE(jsonb_array_length(e->'meta'->'audience_roles'),0)>0 OR COALESCE(e->'meta'->>'audience_terminal_id','')<>'';
  SELECT name INTO branch FROM public.stores WHERE id::text=NEW.store_id;
  FOR r IN SELECT value FROM jsonb_array_elements(cfg->'rules') LOOP
    IF NOT public.notification_rule_matches(r,e) THEN CONTINUE; END IF;
    body:=public.notification_rule_message(r,to_jsonb(NEW));
    due:=public.notification_rule_due(r,now());
    IF r->>'audience'='original' AND r->'channels' ? 'app' AND COALESCE(e->'meta'->>'audience_terminal_id','')<>'' THEN
      INSERT INTO public.notification_deliveries(event_id,rule_id,rule_name,channel,recipient,message,status)
      VALUES(NEW.id,r->>'id',r->>'name','app','terminal:'||(e->'meta'->>'audience_terminal_id'),body,'available') ON CONFLICT DO NOTHING;
      created_count:=created_count+1;
    END IF;
    FOR ch IN SELECT jsonb_array_elements_text(r->'channels') LOOP
      IF ch='whatsapp' AND private_event THEN CONTINUE; END IF;
      FOR who IN SELECT value FROM (SELECT jsonb_array_elements_text(r->'phones') value WHERE ch='whatsapp') phone
        WHERE r->'phoneUsers'->>phone.value IN (SELECT * FROM public.notification_rule_recipients(r,e))
        UNION ALL SELECT * FROM public.notification_rule_recipients(r,e) WHERE ch<>'whatsapp'
      LOOP
        INSERT INTO public.notification_deliveries(event_id,rule_id,rule_name,channel,recipient,recipient_user_id,message,status,next_attempt,reason)
        VALUES(NEW.id,r->>'id',r->>'name',ch,who,CASE WHEN ch='whatsapp' THEN r->'phoneUsers'->>who ELSE who END,body,CASE WHEN ch='app' THEN 'available' ELSE 'queued' END,
          CASE WHEN ch='app' THEN now() ELSE due END,CASE WHEN ch<>'app' AND due>now() THEN 'Quiet hours' ELSE '' END)
        ON CONFLICT(event_id,channel,recipient) DO NOTHING;
        created_count:=created_count+1;
      END LOOP;
    END LOOP;
  END LOOP;
  IF created_count=0 THEN INSERT INTO public.notification_deliveries(event_id,rule_id,rule_name,channel,recipient,status,reason)
    VALUES(NEW.id,'none','No eligible delivery','app','','skipped','No enabled rule matched an eligible recipient'); END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Delivery configuration must not abort a committed business/audit event.
  INSERT INTO public.notification_deliveries(event_id,rule_id,rule_name,channel,recipient,status,reason)
    VALUES(NEW.id,'invalid','Invalid rule configuration','app','','failed','Notification delivery could not be queued') ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_notification_rule_deliveries() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS queue_notification_rule_deliveries ON public.activity_events;
CREATE TRIGGER queue_notification_rule_deliveries AFTER INSERT ON public.activity_events FOR EACH ROW EXECUTE FUNCTION public.queue_notification_rule_deliveries();

CREATE OR REPLACE FUNCTION public.claim_notification_whatsapp(p_limit integer DEFAULT 5)
RETURNS SETOF public.notification_deliveries LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.refresh_notification_delivery_eligibility();
  UPDATE public.notification_deliveries SET status='unknown',reason='Worker stopped after claiming delivery; outcome needs review'
    WHERE channel='whatsapp' AND status='sending' AND next_attempt<now()-interval '10 minutes';
  UPDATE public.notification_deliveries d SET status='skipped',reason='Rule disabled, changed or recipient removed'
    WHERE d.channel='whatsapp' AND d.status='queued' AND NOT EXISTS(
      SELECT 1 FROM public.pos_settings s CROSS JOIN LATERAL jsonb_array_elements(s.notification_settings->'rules') r
      JOIN public.activity_events e ON e.id=d.event_id WHERE s.id=1 AND r->>'id'=d.rule_id AND r->'phones' ? d.recipient
      AND r->'channels' ? 'whatsapp' AND public.notification_rule_matches(r,to_jsonb(e))
      AND d.recipient_user_id=r->'phoneUsers'->>d.recipient
      AND d.recipient_user_id IN (SELECT * FROM public.notification_rule_recipients(r,to_jsonb(e)||jsonb_build_object('meta',COALESCE(e.meta->'notification_original','{}')))));
  RETURN QUERY UPDATE public.notification_deliveries SET status='sending',reason='Delivery claimed',next_attempt=now()
  WHERE id IN (SELECT id FROM public.notification_deliveries WHERE channel='whatsapp' AND status='queued' AND next_attempt<=now()
    ORDER BY created_at,id LIMIT LEAST(GREATEST(p_limit,1),10) FOR UPDATE SKIP LOCKED) RETURNING *;
END
$$;
REVOKE ALL ON FUNCTION public.claim_notification_whatsapp(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_whatsapp(integer) TO service_role;

-- The central worker also revisits due events held by quiet hours, independently
-- of its chronological activity cursor.
CREATE OR REPLACE FUNCTION public.pending_notification_push_events()
RETURNS TABLE(id uuid,created_at timestamptz) LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.refresh_notification_delivery_eligibility();
  RETURN QUERY SELECT DISTINCT e.id,e.created_at FROM public.notification_deliveries d JOIN public.activity_events e ON e.id=d.event_id
  WHERE d.channel='push' AND d.status='queued' AND d.next_attempt<=now() ORDER BY e.created_at,e.id LIMIT 100;
END
$$;
REVOKE ALL ON FUNCTION public.pending_notification_push_events() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pending_notification_push_events() TO service_role;

CREATE OR REPLACE FUNCTION public.authorized_notification_push_users(p_event uuid)
RETURNS SETOF text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT DISTINCT d.recipient FROM public.notification_deliveries d JOIN public.activity_events e ON e.id=d.event_id
    CROSS JOIN public.pos_settings s CROSS JOIN LATERAL jsonb_array_elements(s.notification_settings->'rules') r
  WHERE s.id=1 AND d.event_id=p_event AND d.channel='push' AND d.status IN ('queued','sent') AND d.next_attempt<=now()
    AND r->>'id'=d.rule_id AND r->'channels' ? 'push' AND public.notification_rule_matches(r,to_jsonb(e))
    AND d.recipient IN (SELECT * FROM public.notification_rule_recipients(r,to_jsonb(e)||jsonb_build_object('meta',COALESCE(e.meta->'notification_original','{}'))))
$$;
REVOKE ALL ON FUNCTION public.authorized_notification_push_users(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorized_notification_push_users(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_notification_delivery_eligibility()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE public.notification_deliveries d SET status='skipped',reason='Rule or account is no longer eligible'
  WHERE d.status='queued' AND NOT EXISTS (
    SELECT 1 FROM public.pos_settings s CROSS JOIN LATERAL jsonb_array_elements(s.notification_settings->'rules') r
    JOIN public.activity_events e ON e.id=d.event_id
    WHERE s.id=1 AND r->>'id'=d.rule_id AND r->'channels' ? d.channel AND public.notification_rule_matches(r,to_jsonb(e))
      AND COALESCE(d.recipient_user_id,d.recipient) IN (SELECT * FROM public.notification_rule_recipients(r,to_jsonb(e)||jsonb_build_object('meta',COALESCE(e.meta->'notification_original','{}'))))
      AND (d.channel<>'whatsapp' OR (r->'phones' ? d.recipient AND r->'phoneUsers'->>d.recipient=d.recipient_user_id))
  );
END $$;
REVOKE ALL ON FUNCTION public.refresh_notification_delivery_eligibility() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_notification_delivery_eligibility() TO service_role;

CREATE OR REPLACE FUNCTION public.queue_shift_summary_rule_event()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.pos_settings WHERE id=1 AND jsonb_typeof(notification_settings->'rules')='array') THEN
    INSERT INTO public.activity_events(event_type,severity,title,message,actor_name,store_id,entity_type,entity_id,amount,meta,client_event_id)
    VALUES('shift_summary','info','Day-end shift summary',NEW.summary,NEW.closed_by,NEW.store_id,'shift',NEW.shift_id::text,NEW.total_sales,
      jsonb_build_object('route','/shifts'),'shift-summary-rules:'||NEW.shift_id::text) ON CONFLICT(client_event_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.queue_shift_summary_rule_event() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS queue_shift_summary_rule_event ON public.shift_notifications;
CREATE TRIGGER queue_shift_summary_rule_event AFTER INSERT OR UPDATE ON public.shift_notifications FOR EACH ROW EXECUTE FUNCTION public.queue_shift_summary_rule_event();
NOTIFY pgrst,'reload schema';
COMMIT;
