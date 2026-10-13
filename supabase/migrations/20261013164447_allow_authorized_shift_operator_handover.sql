-- Authorized operators may hand over on the same terminal. Branch and cross-terminal checks remain.
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
  IF (v.terminal_id IS NOT NULL AND v.terminal_id IS DISTINCT FROM p_terminal) AND NOT public.has_perm('can_manage_other_shifts')
    AND NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    AND NOT COALESCE((SELECT integration_settings->'allowAnyStaffCloseShift' = 'true'::jsonb FROM public.pos_settings WHERE id=1),false) THEN
    RAISE EXCEPTION 'You do not have permission to close another terminal shift.';
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

