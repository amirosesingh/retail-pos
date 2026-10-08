-- Cross-group movements always require approval, even when a branch/global
-- stock-transfer action is configured for direct execution.
CREATE OR REPLACE FUNCTION public.stock_transfer_approval_required(_store_id text, _to_store_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN public.is_cross_group_transfer(_store_id, _to_store_id) THEN true
    ELSE COALESCE(
      (
        SELECT false
          FROM public.authorization_actions a
         WHERE a.action_key = 'stock_transfer'
           AND a.is_enabled
           AND (
             (a.scope_type = 'branch' AND a.scope_id = _store_id)
             OR (a.scope_type = 'global' AND a.scope_id = '')
           )
         ORDER BY CASE WHEN a.scope_type = 'branch' THEN 0 ELSE 1 END
         LIMIT 1
      ),
      public.stock_transfer_approval_required(_store_id)
    )
  END
$fn$;

-- Draft stock movements are real persisted notes, but they do not enter the
-- approval lifecycle until the operator explicitly submits them.
CREATE OR REPLACE FUNCTION public.stock_transfers_enforce_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_needs_approval boolean;
  v_cross boolean;
  v_may_approve boolean := public.is_supervisor_now()
    OR public.has_perm('can_approve_transfer');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'draft' THEN
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
      NEW.dispatched_by := NULL;
      NEW.dispatched_at := NULL;
      NEW.received_by := NULL;
      NEW.received_at := NULL;
      NEW.verified_by := NULL;
      NEW.verified_at := NULL;
      NEW.posted_at := NULL;
      NEW.closed_at := NULL;
      NEW.fulfilment := NULL;
      RETURN NEW;
    END IF;

    v_needs_approval := public.stock_transfer_approval_required(NEW.from_store_id, NEW.to_store_id);
    IF v_needs_approval THEN
      NEW.status := 'awaiting_approval';
    ELSIF NEW.status IS NULL OR NEW.status NOT IN ('awaiting_approval', 'approved') THEN
      NEW.status := 'approved';
    END IF;

    IF NEW.status = 'approved' AND NOT v_needs_approval THEN
      NEW.approved_by := COALESCE(NEW.approved_by, NEW.created_by);
      NEW.approved_at := COALESCE(NEW.approved_at, now());
    ELSE
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
    END IF;
    NEW.dispatched_by := NULL;
    NEW.dispatched_at := NULL;
    NEW.received_by := NULL;
    NEW.received_at := NULL;
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
    NEW.posted_at := NULL;
    NEW.closed_at := NULL;
    NEW.fulfilment := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Submitting a draft chooses the server-authoritative next state. A branch
  -- cannot bypass an approval rule by sending "approved" in its payload.
  IF OLD.status = 'draft' THEN
    v_needs_approval := public.stock_transfer_approval_required(NEW.from_store_id, NEW.to_store_id);
    NEW.status := CASE
      WHEN v_needs_approval OR NEW.status = 'awaiting_approval' THEN 'awaiting_approval'
      ELSE 'approved'
    END;
    IF NEW.status = 'approved' THEN
      NEW.approved_by := COALESCE(NEW.approved_by, NEW.created_by);
      NEW.approved_at := COALESCE(NEW.approved_at, now());
    ELSE
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
    END IF;
    NEW.dispatched_by := NULL;
    NEW.dispatched_at := NULL;
    NEW.received_by := NULL;
    NEW.received_at := NULL;
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
    NEW.posted_at := NULL;
    NEW.closed_at := NULL;
    NEW.fulfilment := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('rejected', 'cancelled', 'completed', 'completed_with_discrepancy') THEN
    RAISE EXCEPTION 'Transfer % is closed (%) and cannot change', OLD.ref, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (
    (OLD.status = 'awaiting_approval' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
    OR (OLD.status = 'approved' AND NEW.status IN ('dispatched', 'rejected', 'cancelled'))
    OR (OLD.status = 'dispatched' AND NEW.status = 'received')
    OR (OLD.status = 'received' AND NEW.status IN ('verified', 'completed', 'completed_with_discrepancy'))
    OR (OLD.status = 'verified' AND NEW.status IN ('completed', 'completed_with_discrepancy'))
  ) THEN
    RAISE EXCEPTION 'Transfer % cannot go from % to %', OLD.ref, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  v_cross := public.is_cross_group_transfer(NEW.from_store_id, NEW.to_store_id);
  IF NEW.status IN ('approved', 'rejected') AND NOT v_may_approve THEN
    RAISE EXCEPTION 'You are not allowed to approve or reject transfers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_cross AND NEW.status = 'approved' THEN
    IF NOT public.may_approve_cross_group_transfer() THEN
      RAISE EXCEPTION 'Only an authorised approver can approve a transfer between groups'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF COALESCE(btrim(NEW.approved_by), '') = ''
       OR btrim(lower(NEW.approved_by)) = btrim(lower(COALESCE(NEW.created_by, ''))) THEN
      RAISE EXCEPTION 'A transfer between groups must be approved by someone other than the requester'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.status = 'approved' THEN NEW.approved_at := COALESCE(NEW.approved_at, now()); END IF;
  IF NEW.status = 'rejected' AND COALESCE(btrim(NEW.rejected_reason), '') = '' THEN
    RAISE EXCEPTION 'A rejection needs a reason' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'cancelled' AND COALESCE(btrim(NEW.cancelled_reason), '') = '' THEN
    RAISE EXCEPTION 'A cancellation needs a reason' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'completed_with_discrepancy'
     AND COALESCE(btrim(NEW.discrepancy_reason), '') = '' THEN
    RAISE EXCEPTION 'A discrepancy needs a reason' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'dispatched' THEN
    IF v_cross AND (
         COALESCE(btrim(NEW.approved_by), '') = ''
         OR NEW.approved_at IS NULL
         OR btrim(lower(NEW.approved_by)) = btrim(lower(COALESCE(NEW.created_by, '')))
       ) THEN
      RAISE EXCEPTION 'This transfer crosses groups and has no valid approval'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.dispatched_at := COALESCE(NEW.dispatched_at, now());
    NEW.closed_at := COALESCE(NEW.closed_at, now());
    NEW.fulfilment := (
      SELECT CASE
        WHEN COALESCE(SUM(COALESCE(i.quantity_dispatched, 0)), 0) = 0 THEN 'none'
        WHEN COALESCE(SUM(COALESCE(i.quantity_dispatched, 0)), 0)
             >= COALESCE(SUM(i.quantity), 0) THEN 'full'
        ELSE 'partial'
      END
      FROM public.stock_transfer_items i WHERE i.transfer_id = NEW.id
    );
  END IF;

  IF NEW.status = 'received' THEN NEW.received_at := COALESCE(NEW.received_at, now()); END IF;
  IF NEW.status IN ('verified', 'completed', 'completed_with_discrepancy') THEN
    NEW.received_at := COALESCE(NEW.received_at, now());
    NEW.verified_at := COALESCE(NEW.verified_at, now());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS stock_transfers_enforce_lifecycle ON public.stock_transfers;
CREATE TRIGGER stock_transfers_enforce_lifecycle
BEFORE INSERT OR UPDATE ON public.stock_transfers
FOR EACH ROW EXECUTE FUNCTION public.stock_transfers_enforce_lifecycle();

NOTIFY pgrst, 'reload schema';
