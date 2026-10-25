BEGIN;
-- Missing rules must retain legacy delivery until the owner explicitly saves.
CREATE OR REPLACE FUNCTION public.apply_in_app_notification_preference()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE cfg jsonb; r jsonb; app_ids jsonb:='[]'; push_ids jsonb:='[]'; terminal_ids jsonb:='[]'; ids jsonb; original jsonb; messages jsonb:='{}'; uid text; body text;
BEGIN
  SELECT notification_settings INTO cfg FROM public.pos_settings WHERE id=1;
  IF jsonb_typeof(cfg->'rules') IS DISTINCT FROM 'array' THEN
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
CREATE OR REPLACE FUNCTION public.queue_notification_rule_deliveries()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE cfg jsonb; r jsonb; e jsonb; ch text; who text; body text; due timestamptz; private_event boolean; branch text; created_count int:=0;
BEGIN
  SELECT notification_settings INTO cfg FROM public.pos_settings WHERE id=1;
  IF jsonb_typeof(cfg->'rules') IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
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
NOTIFY pgrst, 'reload schema';
COMMIT;
