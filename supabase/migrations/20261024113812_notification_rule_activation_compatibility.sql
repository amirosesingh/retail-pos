BEGIN;
-- New and old app versions may share this database during beta acceptance.
-- Archive legacy values and retire their delivery paths only at activation.
CREATE OR REPLACE FUNCTION public.guard_notification_rule_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE old_cfg jsonb:=COALESCE(OLD.notification_settings,'{}'); new_cfg jsonb:=COALESCE(NEW.notification_settings,'{}');
BEGIN
  IF jsonb_typeof(old_cfg->'rules')='array' AND jsonb_typeof(new_cfg->'rules') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Notifications use the rules table. Reload the current notification editor before saving.';
  END IF;
  IF jsonb_typeof(new_cfg->'rules')='array' THEN
    new_cfg:=new_cfg||jsonb_build_object(
      'legacyBeforeRules',COALESCE(old_cfg->'legacyBeforeRules',old_cfg-'rules'-'rulesVersion'),
      'enabled',false,'channels','{}'::jsonb,'inApp','{}'::jsonb,
      'androidPush',(CASE WHEN jsonb_typeof(new_cfg->'androidPush')='object' THEN new_cfg->'androidPush' ELSE '{}'::jsonb END)||'{"enabled":false}'::jsonb,
      'shiftAlerts',(CASE WHEN jsonb_typeof(new_cfg->'shiftAlerts')='object' THEN new_cfg->'shiftAlerts' ELSE '{}'::jsonb END)||'{"inApp":false,"whatsapp":false,"push":false}'::jsonb);
    NEW.notification_settings:=new_cfg;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_notification_rule_activation() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_notification_rule_activation ON public.pos_settings;
CREATE TRIGGER guard_notification_rule_activation BEFORE UPDATE OF notification_settings ON public.pos_settings
FOR EACH ROW EXECUTE FUNCTION public.guard_notification_rule_activation();
NOTIFY pgrst, 'reload schema';
COMMIT;
