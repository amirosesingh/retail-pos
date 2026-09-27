-- Column-level SELECT intentionally hides shift tender/count values from a
-- direct Data API query. The secure projection therefore has to read those
-- columns with its owner privileges, while explicitly reproducing every RLS
-- guard before it returns a row to the authenticated caller.
CREATE OR REPLACE FUNCTION public.shift_list_secure(
  p_store_id text DEFAULT NULL,
  p_limit integer DEFAULT 300
)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.to_jsonb(s) || pg_catalog.jsonb_build_object(
    'opening_float', CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN s.opening_float END,
    'expected_cash', CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN s.expected_cash END,
    'expected_card', CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN s.expected_card END,
    'expected_digital', CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN s.expected_digital END,
    'counted_cash', CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN s.counted_cash END,
    'counted_card', CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN s.counted_card END,
    'counted_digital', CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN s.counted_digital END,
    'closing_float', CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN s.closing_float END,
    'final_counted_cash', CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN s.final_counted_cash END,
    'variance_cash', CASE WHEN public.has_perm('can_shift_variance_view') THEN s.variance_cash END,
    'variance_card', CASE WHEN public.has_perm('can_shift_variance_view') THEN s.variance_card END,
    'variance_digital', CASE WHEN public.has_perm('can_shift_variance_view') THEN s.variance_digital END,
    'variance_total', CASE WHEN public.has_perm('can_shift_variance_view') THEN s.variance_total END,
    'variance_status', CASE WHEN public.has_perm('can_shift_variance_view') THEN s.variance_status END
  )
  FROM public.shifts s
  WHERE public.is_staff((SELECT auth.uid()))
    AND public.is_terminal_active()
    AND public.store_visible(s.store_id)
    AND (p_store_id IS NULL OR s.store_id = p_store_id)
  ORDER BY s.opened_at DESC, s.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 1000);
$$;

REVOKE ALL ON FUNCTION public.shift_list_secure(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_list_secure(text, integer) TO authenticated, service_role;

-- The wrapper reads only the already-redacted projection.
CREATE OR REPLACE FUNCTION public.shift_active_secure(p_store_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT secure_row
  FROM public.shift_list_secure(p_store_id, 1000) AS secure_rows(secure_row)
  WHERE secure_row->>'status' = 'OPEN' AND secure_row->>'closed_at' IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.shift_active_secure(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_active_secure(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
