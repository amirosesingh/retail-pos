-- Captured public routine definition only; no business rows or credentials.
-- ROSEGILL pos read-only capture: 2026-11-03; prosrc MD5 8e70ac04aaa3368aea5cbcbe9bd1434a.
CREATE OR REPLACE FUNCTION public.shift_reconcile_now(p_shift uuid, p_count_id uuid, p_cash numeric, p_card numeric, p_digital numeric)
 RETURNS TABLE(state text, variance_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v public.shifts%ROWTYPE; e record; v_rec uuid;
  v_var_cash numeric; v_var_card numeric; v_var_digital numeric; v_total numeric;
  v_status text; v_threshold numeric := 0; v_state text;
  v_store_name text; v_cashier text; v_terminal text; v_msg text;
  v_total_sales numeric := 0; v_net_cash_sales numeric := 0;
BEGIN
  SELECT * INTO v FROM public.shifts WHERE id = p_shift;
  SELECT * INTO e FROM public.shift_expected_totals(p_shift);

  v_var_cash    := round(p_cash - e.expected_cash, 2);
  v_var_card    := CASE WHEN p_card IS NULL THEN NULL ELSE round(p_card - e.expected_card, 2) END;
  v_var_digital := CASE WHEN p_digital IS NULL THEN NULL ELSE round(p_digital - e.expected_digital, 2) END;
  v_total       := round(v_var_cash + coalesce(v_var_card,0) + coalesce(v_var_digital,0), 2);

  SELECT coalesce(abs((r ->> 'variance_pin_threshold')::numeric), 0) INTO v_threshold
    FROM public.pos_rules_get() AS r;
  IF v_threshold IS NULL THEN v_threshold := 0; END IF;

  v_status := CASE WHEN abs(v_total) <= 0.005 THEN 'NO_VARIANCE'
                   WHEN v_total > 0 THEN 'OVER' ELSE 'SHORT' END;
  v_state := 'CLOSED';

  PERFORM set_config('pos.shift_fn', 'on', true);
  INSERT INTO public.shift_reconciliations
    (shift_id, store_id, count_id, expected_cash, expected_card, expected_digital,
     counted_cash, counted_card, counted_digital,
     variance_cash, variance_card, variance_digital, variance_total, variance_status)
  VALUES (p_shift, v.store_id, p_count_id, e.expected_cash, e.expected_card, e.expected_digital,
          p_cash, p_card, p_digital, v_var_cash, v_var_card, v_var_digital, v_total, v_status)
  RETURNING id INTO v_rec;

  UPDATE public.shifts
     SET state = v_state, status = 'CLOSED', closed_at = coalesce(closed_at, now()),
         final_counted_cash = p_cash, counted_cash = p_cash, closing_float = p_cash,
         counted_card = p_card, counted_digital = p_digital,
         variance_status = v_status, updated_at = now()
   WHERE id = p_shift;

  IF v_status <> 'NO_VARIANCE' THEN
    SELECT coalesce(nullif(btrim(name), ''), v.store_id) INTO v_store_name
      FROM public.stores WHERE id = v.store_id;
    v_store_name := coalesce(v_store_name, v.store_id, '');
    SELECT coalesce(nullif(btrim(counted_by_name), ''), v.opened_by_name, '')
      INTO v_cashier FROM public.shift_cash_counts WHERE id = p_count_id;
    v_cashier := coalesce(v_cashier, v.opened_by_name, '');
    v_terminal := coalesce(nullif(btrim(v.terminal_name), ''), v.terminal_id, '');
    SELECT coalesce(sum(s.total_amount), 0) INTO v_total_sales
      FROM public.sales s
     WHERE s.shift_id = p_shift::text AND coalesce(s.is_refunded, false) = false;
    v_net_cash_sales := round(e.expected_cash - coalesce(v.opening_float, 0), 2);

    INSERT INTO public.shift_variance_alerts
      (shift_id, store_id, reconciliation_id, variance_total, variance_status, severity, message)
    VALUES (p_shift, v.store_id, v_rec, v_total, v_status,
            CASE WHEN abs(v_total) > v_threshold THEN 'critical' ELSE 'warning' END,
            format('Shift at %s closed %s by %s. Cashier %s, terminal %s. Opening %s, sales %s, net cash sales %s, expected cash %s, counted cash %s.',
                   v_store_name, lower(v_status), abs(v_total), v_cashier, v_terminal,
                   to_char(coalesce(v.opening_float, 0), 'FM999999990.00'),
                   to_char(v_total_sales, 'FM999999990.00'),
                   to_char(v_net_cash_sales, 'FM999999990.00'),
                   to_char(e.expected_cash, 'FM999999990.00'), to_char(p_cash, 'FM999999990.00')))
    ON CONFLICT (reconciliation_id) DO NOTHING;

    v_msg := format(
      E'Cashier: %s\nBranch: %s\nTerminal: %s\nShift: %s\nClosed: %s\n\nOpening float: %s\nTotal sales: %s\nNet cash sales: %s\nExpected cash: %s\nCounted cash: %s\nCard expected / counted: %s / %s\nDigital expected / counted: %s / %s\nVariance: %s\n\nType: Cash %s',
      v_cashier, v_store_name, v_terminal,
      p_shift::text, to_char(now(), 'YYYY-MM-DD HH24:MI:SS TZ'),
      to_char(coalesce(v.opening_float, 0), 'FM999999990.00'),
      to_char(v_total_sales, 'FM999999990.00'),
      to_char(v_net_cash_sales, 'FM999999990.00'),
      to_char(e.expected_cash, 'FM999999990.00'), to_char(p_cash, 'FM999999990.00'),
      to_char(e.expected_card, 'FM999999990.00'), coalesce(to_char(p_card, 'FM999999990.00'), 'not counted'),
      to_char(e.expected_digital, 'FM999999990.00'), coalesce(to_char(p_digital, 'FM999999990.00'), 'not counted'),
      CASE WHEN v_total > 0 THEN '+' ELSE '-' END || to_char(abs(v_total), 'FM999999990.00'),
      CASE WHEN v_total > 0 THEN 'Overage' ELSE 'Shortage' END);

    INSERT INTO public.activity_events
      (event_type, severity, title, message, actor_name, terminal_id, store_id,
       branch_id, entity_type, entity_id, amount, meta, client_event_id, created_at)
    VALUES ('shift_cash_variance',
            CASE WHEN abs(v_total) > v_threshold THEN 'critical' ELSE 'warning' END,
            'Shift cash variance detected', v_msg, nullif(v_cashier, ''),
            nullif(v_terminal, ''), v.store_id, v.store_id, 'shift', p_shift::text, v_total,
            jsonb_build_object('branch_name', v_store_name, 'terminal_name', v_terminal,
                               'opened_at', v.opened_at, 'closed_at', now(),
                               'opening_float', coalesce(v.opening_float, 0),
                               'total_sales', v_total_sales, 'net_cash_sales', v_net_cash_sales,
                               'expected_cash', e.expected_cash, 'counted_cash', p_cash,
                               'expected_card', e.expected_card, 'counted_card', p_card,
                               'expected_digital', e.expected_digital, 'counted_digital', p_digital,
                               'variance_total', v_total, 'variance_status', v_status,
                               'reconciliation_id', v_rec),
            'shift:' || p_shift::text || ':cash_variance', now())
    ON CONFLICT (client_event_id) DO NOTHING;
  END IF;
  PERFORM set_config('pos.shift_fn', '', true);
  PERFORM public.shift_log_event(p_shift, 'reconciled', 'CASH_COUNT_SUBMITTED', v_state,
    jsonb_build_object('variance_status', v_status, 'variance_total', v_total), v.terminal_id);
  RETURN QUERY SELECT v_state, v_status;
END $function$
