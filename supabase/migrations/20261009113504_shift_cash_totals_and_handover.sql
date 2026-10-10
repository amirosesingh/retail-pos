CREATE OR REPLACE FUNCTION public.shift_expected_totals(p_shift uuid)
RETURNS TABLE (expected_cash numeric, expected_card numeric, expected_digital numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_float numeric := 0; v_store text;
BEGIN
  SELECT coalesce(opening_float,0),store_id INTO v_float,v_store FROM public.shifts WHERE id=p_shift;
  IF NOT FOUND THEN RAISE EXCEPTION 'That shift no longer exists.'; END IF;
  RETURN QUERY
  WITH parts AS (
    SELECT s.total_amount,
      CASE WHEN jsonb_typeof(s.payments)='array' THEN jsonb_array_length(s.payments)>0 ELSE false END AS split,
      lower(coalesce(s.payment_type,'')) AS method,
      p.cash,p.card,p.digital,p.paid
    FROM public.sales s
    LEFT JOIN LATERAL (
      SELECT coalesce(sum((entry->>'amount')::numeric),0) AS paid,
        coalesce(sum((entry->>'amount')::numeric) FILTER (WHERE lower(entry->>'method')='cash'),0) AS cash,
        coalesce(sum((entry->>'amount')::numeric) FILTER (WHERE lower(entry->>'method')='card'),0) AS card,
        coalesce(sum((entry->>'amount')::numeric) FILTER (WHERE lower(entry->>'method') IN ('wallet','bank_transfer','transfer','qr','online','ewallet')),0) AS digital
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.payments)='array' THEN s.payments ELSE '[]'::jsonb END) entry
    ) p ON true
    WHERE s.shift_id=p_shift::text AND s.store_id=v_store AND NOT coalesce(s.is_refunded,false)
  ), net AS (
    SELECT CASE WHEN split THEN CASE WHEN cash>0 THEN greatest(0,cash-greatest(0,paid-coalesce(total_amount,0))) ELSE cash END
      WHEN method='cash' THEN coalesce(total_amount,0) ELSE 0 END AS cash,
      CASE WHEN split THEN card WHEN method='card' THEN coalesce(total_amount,0) ELSE 0 END AS card,
      CASE WHEN split THEN digital WHEN method IN ('wallet','bank_transfer','transfer','qr','online','ewallet') THEN coalesce(total_amount,0) ELSE 0 END AS digital FROM parts
  )
  SELECT round(v_float+coalesce(sum(cash),0),2),round(coalesce(sum(card),0),2),round(coalesce(sum(digital),0),2) FROM net;
END $$;

CREATE OR REPLACE FUNCTION public.shift_close_start(p_shift uuid, p_reason text, p_terminal text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.shifts%ROWTYPE; v_me record; v_reason text := btrim(coalesce(p_reason,''));
BEGIN
  IF NOT public.has_perm('can_close_shift') THEN
    RAISE EXCEPTION 'You do not have permission to close a shift.';
  END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'A reason for closing this shift is required.'; END IF;

  SELECT * INTO v FROM public.shifts WHERE id = p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That shift no longer exists.'; END IF;
  IF NOT public.store_visible(v.store_id) THEN RAISE EXCEPTION 'That shift belongs to another branch.'; END IF;

  SELECT * INTO v_me FROM public.current_app_user();
  IF (
    (v.opened_by_staff_id IS NOT NULL AND v.opened_by_staff_id::text IS DISTINCT FROM v_me.user_id::text)
    OR (v.terminal_id IS NOT NULL AND v.terminal_id IS DISTINCT FROM p_terminal)
  ) AND NOT public.has_perm('can_manage_other_shifts')
    AND NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    AND NOT COALESCE((SELECT integration_settings->'allowAnyStaffCloseShift' = 'true'::jsonb FROM public.pos_settings WHERE id=1),false) THEN
    RAISE EXCEPTION 'You do not have permission to close another employee or terminal shift.';
  END IF;

  IF v.state <> 'ACTIVE' THEN
    -- Already closing: never go backwards, just report where it is.
    RETURN v.state;
  END IF;

  PERFORM set_config('pos.shift_fn', 'on', true);
  UPDATE public.shifts
     SET state = 'CASH_COUNT_REQUIRED',
         close_reason = v_reason,
         closing_started_at = now(),
         closing_started_by = coalesce(v_me.full_name, v.opened_by_name),
         updated_at = now()
   WHERE id = p_shift;
  PERFORM set_config('pos.shift_fn', '', true);

  PERFORM public.shift_log_event(
    p_shift, 'closing_started', 'ACTIVE', 'CASH_COUNT_REQUIRED',
    jsonb_build_object(
      'reason', v_reason,
      'forced', (v.opened_by_staff_id IS NOT NULL AND v.opened_by_staff_id::text IS DISTINCT FROM v_me.user_id::text)
                OR (v.terminal_id IS NOT NULL AND v.terminal_id IS DISTINCT FROM p_terminal),
      'opened_by_staff_id', v.opened_by_staff_id,
      'opened_terminal_id', v.terminal_id
    ),
    p_terminal
  );
  RETURN 'CASH_COUNT_REQUIRED';
END $$;

CREATE OR REPLACE FUNCTION public.shift_expected_view(p_shift uuid)
RETURNS TABLE (expected_cash numeric, expected_card numeric, expected_digital numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_perm('can_shift_expected_cash_view') AND NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'You do not have permission to view expected cash.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id=p_shift AND public.store_visible(store_id)) THEN
    RAISE EXCEPTION 'That shift does not exist in your branch scope.';
  END IF;
  RETURN QUERY SELECT * FROM public.shift_expected_totals(p_shift);
END $$;
NOTIFY pgrst, 'reload schema';
