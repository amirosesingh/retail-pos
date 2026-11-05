-- Read-only history pagination. Keep the existing shift projection's exact
-- permission masks and branch/active-terminal gates; do not grant table access.
BEGIN;
CREATE INDEX IF NOT EXISTS shifts_history_by_store_opened_id ON public.shifts(store_id,opened_at DESC,id DESC);
CREATE OR REPLACE FUNCTION private.shift_page_secure_impl(
 p_store_id text,p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,
 p_before_opened_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 500
)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
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
  AND (SELECT public.is_terminal_active()) AND public.store_visible(s.store_id)
  AND NULLIF(btrim(p_store_id),'') IS NOT NULL AND s.store_id=p_store_id
  AND (p_from IS NULL OR s.opened_at>=p_from) AND (p_to IS NULL OR s.opened_at<=p_to)
  AND ((p_before_opened_at IS NULL AND p_before_id IS NULL)
    OR (p_before_opened_at IS NOT NULL AND p_before_id IS NOT NULL
      AND (s.opened_at,s.id)<(p_before_opened_at,p_before_id)))
 ORDER BY s.opened_at DESC,s.id DESC LIMIT LEAST(GREATEST(COALESCE(p_limit,500),1),500)
$fn$;
REVOKE ALL ON FUNCTION private.shift_page_secure_impl(text,timestamptz,timestamptz,timestamptz,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.shift_page_secure_impl(text,timestamptz,timestamptz,timestamptz,uuid,integer) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.shift_page_secure(
 p_store_id text,p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,
 p_before_opened_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 500
)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
 SELECT * FROM private.shift_page_secure_impl(p_store_id,p_from,p_to,p_before_opened_at,p_before_id,p_limit)
$fn$;
REVOKE ALL ON FUNCTION public.shift_page_secure(text,timestamptz,timestamptz,timestamptz,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.shift_page_secure(text,timestamptz,timestamptz,timestamptz,uuid,integer) TO authenticated,service_role;
COMMIT;
