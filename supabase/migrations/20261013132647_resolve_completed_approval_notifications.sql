-- Preserve event history while removing completed approval actions from alerts.
CREATE OR REPLACE FUNCTION public.pos_resolve_approval_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE public.activity_events e
  SET cleared_by = ARRAY['system:approval-resolved']::text[]
  WHERE e.entity_type = 'authorization_request' AND e.entity_id = NEW.id::text
    AND (e.store_id IS NOT DISTINCT FROM NULLIF(NEW.store_id, ''))
    AND COALESCE(cardinality(e.cleared_by), 0) = 0
    AND ((e.event_type = 'approval_requested' AND NEW.status <> 'pending')
      OR (e.event_type = 'approval_granted' AND NEW.consumed_at IS NOT NULL));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_resolve_approval_notifications() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pos_resolve_approval_notifications ON public.authorization_requests;
CREATE TRIGGER pos_resolve_approval_notifications AFTER UPDATE OF status, consumed_at
ON public.authorization_requests FOR EACH ROW EXECUTE FUNCTION public.pos_resolve_approval_notifications();

-- An event can arrive after its approval was consumed. Lock the request first,
-- matching the decision path's lock order, and preserve the event as history.
CREATE OR REPLACE FUNCTION public.pos_resolve_late_approval_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE request_row public.authorization_requests%ROWTYPE;
BEGIN
  IF NEW.entity_type <> 'authorization_request'
     OR NEW.event_type NOT IN ('approval_requested','approval_granted')
     OR NEW.entity_id IS NULL OR NEW.entity_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO request_row FROM public.authorization_requests
    WHERE id = NEW.entity_id::uuid AND NULLIF(store_id,'') IS NOT DISTINCT FROM NULLIF(NEW.store_id,'')
    FOR SHARE;
  IF FOUND AND ((NEW.event_type='approval_requested' AND request_row.status<>'pending')
    OR (NEW.event_type='approval_granted' AND request_row.consumed_at IS NOT NULL)) THEN
    NEW.cleared_by := ARRAY['system:approval-resolved']::text[];
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_resolve_late_approval_notification() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS pos_resolve_late_approval_notification ON public.activity_events;
CREATE TRIGGER pos_resolve_late_approval_notification BEFORE INSERT ON public.activity_events
FOR EACH ROW EXECUTE FUNCTION public.pos_resolve_late_approval_notification();

-- Catch up alerts from requests already decided or used; no audit rows deleted.
UPDATE public.activity_events e
SET cleared_by = ARRAY['system:approval-resolved']::text[]
FROM public.authorization_requests r
WHERE e.entity_type = 'authorization_request' AND e.entity_id = r.id::text
  AND (e.store_id IS NOT DISTINCT FROM NULLIF(r.store_id, ''))
  AND COALESCE(cardinality(e.cleared_by), 0) = 0
  AND ((e.event_type = 'approval_requested' AND r.status <> 'pending')
    OR (e.event_type = 'approval_granted' AND r.consumed_at IS NOT NULL));
