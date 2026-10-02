-- Administrator-only corrections for posted financial records.
-- This migration is additive: original cash declarations and audit rows remain immutable.

-- Session rows are server-owned. An explicit deny policy documents that
-- boundary and avoids the ambiguous "RLS enabled, no policy" configuration.
REVOKE ALL ON TABLE public.user_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.user_sessions TO service_role;
DROP POLICY IF EXISTS "server-only deny client access" ON public.user_sessions;
CREATE POLICY "server-only deny client access" ON public.user_sessions
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.pos_admin_correct_closed_shift(
  p_shift uuid,
  p_cash numeric,
  p_card numeric,
  p_digital numeric,
  p_reason text,
  p_actor_id text,
  p_actor_name text,
  p_terminal text,
  p_client_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v public.shifts%ROWTYPE;
  e record;
  v_count uuid;
  v_rec uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before jsonb;
  v_after jsonb;
  v_var_cash numeric;
  v_var_card numeric;
  v_var_digital numeric;
  v_total numeric;
  v_status text;
BEGIN
  IF char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'A correction reason of at least 3 characters is required.';
  END IF;
  IF nullif(btrim(coalesce(p_client_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A client correction key is required.';
  END IF;
  IF p_cash IS NULL OR p_cash < 0 OR (p_card IS NOT NULL AND p_card < 0)
     OR (p_digital IS NOT NULL AND p_digital < 0) THEN
    RAISE EXCEPTION 'Counted tender amounts cannot be negative.';
  END IF;

  -- A retry of the same browser request is a read, never a second correction.
  SELECT shift_id INTO v_count
    FROM public.shift_cash_counts
   WHERE client_key = p_client_key
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'shift_id', v_count);
  END IF;

  SELECT * INTO v FROM public.shifts WHERE id = p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That shift no longer exists.'; END IF;
  IF v.status <> 'CLOSED' OR coalesce(v.state, 'CLOSED') <> 'CLOSED' THEN
    RAISE EXCEPTION 'Only a closed shift can be corrected.';
  END IF;

  SELECT * INTO e FROM public.shift_expected_totals(p_shift);
  v_var_cash := round(p_cash - e.expected_cash, 2);
  v_var_card := CASE WHEN p_card IS NULL THEN NULL ELSE round(p_card - e.expected_card, 2) END;
  v_var_digital := CASE WHEN p_digital IS NULL THEN NULL ELSE round(p_digital - e.expected_digital, 2) END;
  v_total := round(v_var_cash + coalesce(v_var_card, 0) + coalesce(v_var_digital, 0), 2);
  v_status := CASE WHEN abs(v_total) <= 0.005 THEN 'NO_VARIANCE'
                   WHEN v_total > 0 THEN 'OVER' ELSE 'SHORT' END;

  v_before := jsonb_build_object(
    'counted_cash', v.counted_cash,
    'counted_card', v.counted_card,
    'counted_digital', v.counted_digital,
    'expected_cash', v.expected_cash,
    'expected_card', v.expected_card,
    'expected_digital', v.expected_digital,
    'variance_cash', v.variance_cash,
    'variance_card', v.variance_card,
    'variance_digital', v.variance_digital,
    'variance_total', v.variance_total,
    'variance_status', v.variance_status
  );

  -- RECOUNT is append-only; the ORIGINAL declaration is retained unchanged.
  INSERT INTO public.shift_cash_counts
    (shift_id, store_id, terminal_id, kind, counted_cash, counted_card, counted_digital,
     reason, counted_by_name, counted_by_staff_id, client_key)
  VALUES
    (p_shift, v.store_id, coalesce(p_terminal, v.terminal_id), 'RECOUNT', p_cash, p_card,
     p_digital, v_reason, nullif(p_actor_name, ''), nullif(p_actor_id, ''), p_client_key)
  RETURNING id INTO v_count;

  INSERT INTO public.shift_reconciliations
    (shift_id, store_id, count_id, expected_cash, expected_card, expected_digital,
     counted_cash, counted_card, counted_digital, variance_cash, variance_card,
     variance_digital, variance_total, variance_status)
  VALUES
    (p_shift, v.store_id, v_count, e.expected_cash, e.expected_card, e.expected_digital,
     p_cash, p_card, p_digital, v_var_cash, v_var_card, v_var_digital, v_total, v_status)
  RETURNING id INTO v_rec;

  PERFORM set_config('pos.shift_fn', 'on', true);
  UPDATE public.shifts
     SET counted_cash = p_cash,
         final_counted_cash = p_cash,
         closing_float = p_cash,
         counted_card = p_card,
         counted_digital = p_digital,
         expected_cash = e.expected_cash,
         expected_card = e.expected_card,
         expected_digital = e.expected_digital,
         variance_cash = v_var_cash,
         variance_card = v_var_card,
         variance_digital = v_var_digital,
         variance_total = v_total,
         variance_status = v_status,
         row_version = coalesce(row_version, 0) + 1,
         updated_at = now()
   WHERE id = p_shift;
  PERFORM set_config('pos.shift_fn', '', true);

  v_after := jsonb_build_object(
    'counted_cash', p_cash,
    'counted_card', p_card,
    'counted_digital', p_digital,
    'expected_cash', e.expected_cash,
    'expected_card', e.expected_card,
    'expected_digital', e.expected_digital,
    'variance_cash', v_var_cash,
    'variance_card', v_var_card,
    'variance_digital', v_var_digital,
    'variance_total', v_total,
    'variance_status', v_status
  );

  INSERT INTO public.record_edits
    (record_type, record_id, reference, store_id, terminal_id, action_key, edited_by,
     edited_by_name, authorized_by, authorized_by_name, mode_used, before_value,
     after_value, note)
  VALUES
    ('shift', p_shift::text, p_shift::text, v.store_id, coalesce(p_terminal, v.terminal_id),
     'SHIFT_CLOSE_CORRECTED', nullif(p_actor_id, ''), nullif(p_actor_name, ''),
     nullif(p_actor_id, ''), nullif(p_actor_name, ''), 'admin', v_before, v_after, v_reason);

  INSERT INTO public.activity_events
    (severity, title, message, actor_id, actor_name, actor_role, terminal_id, store_id,
     entity_type, entity_id, amount, meta, client_event_id)
  VALUES
    ('warning', 'Closed shift corrected', v_reason, nullif(p_actor_id, ''),
     nullif(p_actor_name, ''), 'admin', coalesce(p_terminal, v.terminal_id), v.store_id,
     'shift', p_shift::text, v_total,
     jsonb_build_object('before', v_before, 'after', v_after, 'reconciliation_id', v_rec),
     'shift-correction:' || p_client_key)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'replayed', false, 'shift_id', p_shift,
                            'variance_total', v_total, 'variance_status', v_status);
END
$fn$;

REVOKE ALL ON FUNCTION public.pos_admin_correct_closed_shift(
  uuid, numeric, numeric, numeric, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_admin_correct_closed_shift(
  uuid, numeric, numeric, numeric, text, text, text, text, text
) TO service_role;

-- Tender edits are corrections too: authenticated managers with a legacy
-- permission may no longer change a completed bill. Refund routines continue
-- to use their dedicated, append-only workflow.
CREATE OR REPLACE FUNCTION public.enforce_sale_permissions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $fn$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF coalesce(NEW.discount_amount, 0) > 0 OR coalesce(NEW.coupon_discount, 0) > 0 THEN
    IF NOT public.has_perm('can_give_discount') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_DISCOUNT';
    END IF;
  END IF;
  IF coalesce(NEW.is_refunded, false) THEN
    IF NOT public.has_perm('can_process_refund') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_REFUND';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (NEW.payment_type IS DISTINCT FROM OLD.payment_type
          OR NEW.payments IS DISTINCT FROM OLD.payments) THEN
    SELECT lower(a.role::text) INTO v_role
      FROM public.app_users a
     WHERE a.is_active
       AND (a.auth_user_id = auth.uid()
            OR lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
     LIMIT 1;
    IF coalesce(v_role, '') <> 'admin' THEN
      RAISE EXCEPTION 'ADMIN_REQUIRED_TENDER_EDIT';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
