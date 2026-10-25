-- Select the open shift before JSON projection and financial redaction.
-- Preserve the history reader, auth/terminal/store guards, ordering and masks.
CREATE OR REPLACE FUNCTION private.shift_active_secure_impl(p_store_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.to_jsonb(s) || pg_catalog.jsonb_build_object(
    'opening_float', CASE WHEN (SELECT public.has_perm('can_shift_expected_cash_view')) THEN s.opening_float END,
    'expected_cash', CASE WHEN (SELECT public.has_perm('can_shift_expected_cash_view')) THEN s.expected_cash END,
    'expected_card', CASE WHEN (SELECT public.has_perm('can_shift_expected_cash_view')) THEN s.expected_card END,
    'expected_digital', CASE WHEN (SELECT public.has_perm('can_shift_expected_cash_view')) THEN s.expected_digital END,
    'counted_cash', CASE WHEN (SELECT public.has_perm('can_shift_counted_cash_view')) THEN s.counted_cash END,
    'counted_card', CASE WHEN (SELECT public.has_perm('can_shift_counted_cash_view')) THEN s.counted_card END,
    'counted_digital', CASE WHEN (SELECT public.has_perm('can_shift_counted_cash_view')) THEN s.counted_digital END,
    'closing_float', CASE WHEN (SELECT public.has_perm('can_shift_counted_cash_view')) THEN s.closing_float END,
    'final_counted_cash', CASE WHEN (SELECT public.has_perm('can_shift_counted_cash_view')) THEN s.final_counted_cash END,
    'variance_cash', CASE WHEN (SELECT public.has_perm('can_shift_variance_view')) THEN s.variance_cash END,
    'variance_card', CASE WHEN (SELECT public.has_perm('can_shift_variance_view')) THEN s.variance_card END,
    'variance_digital', CASE WHEN (SELECT public.has_perm('can_shift_variance_view')) THEN s.variance_digital END,
    'variance_total', CASE WHEN (SELECT public.has_perm('can_shift_variance_view')) THEN s.variance_total END,
    'variance_status', CASE WHEN (SELECT public.has_perm('can_shift_variance_view')) THEN s.variance_status END
  )
  FROM public.shifts s
  WHERE (SELECT public.is_staff((SELECT auth.uid())))
    AND (SELECT public.is_terminal_active())
    AND public.store_visible(s.store_id)
    AND (p_store_id IS NULL OR s.store_id = p_store_id)
    AND s.status = 'OPEN' AND s.closed_at IS NULL
  ORDER BY s.opened_at DESC, s.id
  LIMIT 1;
$$;


REVOKE ALL ON FUNCTION private.shift_active_secure_impl(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.shift_active_secure_impl(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shift_active_secure(p_store_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT private.shift_active_secure_impl(p_store_id);
$$;
REVOKE ALL ON FUNCTION public.shift_active_secure(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_active_secure(text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
