-- Direct authenticated inserts must carry the database-verified actor.
-- Client timelines remain reports; only mutation-owned audit entries prove actions.
CREATE OR REPLACE FUNCTION public.stamp_status_history_reporter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE reporter record;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL THEN
    SELECT * INTO reporter FROM public.current_app_user();
    IF reporter.user_id IS NULL OR reporter.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Active staff account required' USING ERRCODE='42501';
    END IF;
    IF reporter.role::text <> 'admin' THEN
      IF reporter.store_id IS NULL OR
         (NEW.store_id IS NOT NULL AND lower(NEW.store_id) <> lower(reporter.store_id)) THEN
        RAISE EXCEPTION 'Branch scope required' USING ERRCODE='42501';
      END IF;
      NEW.store_id := reporter.store_id;
    END IF;
    NEW.actor_id := reporter.user_id;
    NEW.actor_name := reporter.full_name;
    NEW.actor_role := reporter.role::text;
    NEW.branch_id := NEW.store_id;
    NEW.terminal_id := NULL;
  END IF;
  NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb) || '{"client_reported":true}'::jsonb;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.stamp_status_history_reporter() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS entity_status_history_reporter ON public.entity_status_history;
CREATE TRIGGER entity_status_history_reporter BEFORE INSERT ON public.entity_status_history
FOR EACH ROW EXECUTE FUNCTION public.stamp_status_history_reporter();
