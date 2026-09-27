-- Consolidate transfer policies and make reconciliation reads RLS-backed.

DROP POLICY IF EXISTS "Branch staff raise transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Branch staff read transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Branch staff update transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Branch supervisors delete transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Branch staff add transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Branch staff delete transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Branch staff read transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Branch staff update transfer items" ON public.stock_transfer_items;

DROP POLICY IF EXISTS "Permission holders read shift reconciliations" ON public.shift_reconciliations;
CREATE POLICY "Permission holders read shift reconciliations"
  ON public.shift_reconciliations FOR SELECT TO authenticated
  USING (
    public.store_visible(store_id)
    AND (
      public.has_perm('can_shift_expected_cash_view')
      OR public.has_perm('can_shift_counted_cash_view')
      OR public.has_perm('can_shift_variance_view')
    )
  );

CREATE OR REPLACE FUNCTION public.shift_reconciliation_view(p_shift uuid)
RETURNS TABLE (
  id uuid, shift_id uuid, store_id text, count_id uuid,
  expected_cash numeric, expected_card numeric, expected_digital numeric,
  counted_cash numeric, counted_card numeric, counted_digital numeric,
  variance_cash numeric, variance_card numeric, variance_digital numeric,
  variance_total numeric, variance_status text, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    r.id, r.shift_id, r.store_id, r.count_id,
    CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN r.expected_cash END,
    CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN r.expected_card END,
    CASE WHEN public.has_perm('can_shift_expected_cash_view') THEN r.expected_digital END,
    CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN r.counted_cash END,
    CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN r.counted_card END,
    CASE WHEN public.has_perm('can_shift_counted_cash_view') THEN r.counted_digital END,
    CASE WHEN public.has_perm('can_shift_variance_view') THEN r.variance_cash END,
    CASE WHEN public.has_perm('can_shift_variance_view') THEN r.variance_card END,
    CASE WHEN public.has_perm('can_shift_variance_view') THEN r.variance_digital END,
    CASE WHEN public.has_perm('can_shift_variance_view') THEN r.variance_total END,
    CASE WHEN public.has_perm('can_shift_variance_view') THEN r.variance_status END,
    r.created_at
  FROM public.shift_reconciliations r
  WHERE r.shift_id = p_shift
    AND public.store_visible(r.store_id)
  ORDER BY r.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.shift_reconciliation_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_reconciliation_view(uuid) TO authenticated, service_role;
