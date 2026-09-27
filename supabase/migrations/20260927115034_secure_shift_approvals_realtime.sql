-- Atomic approval decisions, permission-redacted shift reconciliation reads,
-- and Realtime coverage for centrally scoped settings.

CREATE OR REPLACE FUNCTION public.authorization_decide_request(
  p_id uuid,
  p_approve boolean,
  p_decided_by text,
  p_decided_by_name text,
  p_note text DEFAULT '',
  p_approved_amount numeric DEFAULT NULL,
  p_approved_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS SETOF public.authorization_requests
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  UPDATE public.authorization_requests
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_by = p_decided_by,
         decided_by_name = p_decided_by_name,
         decided_at = now(),
         decision_note = COALESCE(p_note, ''),
         approved_amount = CASE WHEN p_approve THEN p_approved_amount ELSE NULL END,
         approved_payload = CASE WHEN p_approve THEN COALESCE(p_approved_payload, '{}'::jsonb) ELSE '{}'::jsonb END,
         updated_at = now()
   WHERE id = p_id
     AND status = 'pending'
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.authorization_decide_request(uuid, boolean, text, text, text, numeric, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorization_decide_request(uuid, boolean, text, text, text, numeric, jsonb)
  TO service_role;

DROP POLICY IF EXISTS "Staff read shift cash counts" ON public.shift_cash_counts;
CREATE POLICY "Permission holders read shift cash counts"
  ON public.shift_cash_counts FOR SELECT TO authenticated
  USING (
    public.has_perm('can_shift_counted_cash_view')
    AND public.store_visible(store_id)
  );

DROP POLICY IF EXISTS "Staff read shift close events" ON public.shift_close_events;
CREATE POLICY "Permission holders read shift close events"
  ON public.shift_close_events FOR SELECT TO authenticated
  USING (
    public.has_perm('can_shift_closing_history_view')
    AND public.store_visible(store_id)
  );

REVOKE SELECT ON public.shift_reconciliations FROM authenticated;
DROP POLICY IF EXISTS "Variance viewers read reconciliations" ON public.shift_reconciliations;

CREATE OR REPLACE FUNCTION public.shift_reconciliation_view(p_shift uuid)
RETURNS TABLE (
  id uuid,
  shift_id uuid,
  store_id text,
  count_id uuid,
  expected_cash numeric,
  expected_card numeric,
  expected_digital numeric,
  counted_cash numeric,
  counted_card numeric,
  counted_digital numeric,
  variance_cash numeric,
  variance_card numeric,
  variance_digital numeric,
  variance_total numeric,
  variance_status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    r.id,
    r.shift_id,
    r.store_id,
    r.count_id,
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
    AND (
      public.has_perm('can_shift_expected_cash_view')
      OR public.has_perm('can_shift_counted_cash_view')
      OR public.has_perm('can_shift_variance_view')
    )
  ORDER BY r.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.shift_reconciliation_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_reconciliation_view(uuid) TO authenticated, service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['settings_overrides', 'settings_locks', 'settings_scoped']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
      IF NOT EXISTS (
        SELECT 1
          FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END IF;
  END LOOP;
END $$;


-- Never expose shift tender totals through an unrestricted row SELECT. The
-- invoker functions below apply RLS and redact each financial group using the
-- caller's current permission matrix.
REVOKE SELECT ON public.shifts FROM authenticated;
GRANT SELECT (
  id, store_id, terminal_id, terminal_name, opened_by_name, opened_by_staff_id,
  opened_by_role, closed_by_name, closed_by_staff_id, closed_by_role, opened_at,
  closed_at, note, overdue, created_at, updated_at, status, user_id, row_version,
  state, close_reason, closing_started_at, closing_started_by
) ON public.shifts TO authenticated;

CREATE OR REPLACE FUNCTION public.shift_list_secure(
  p_store_id text DEFAULT NULL,
  p_limit integer DEFAULT 300
)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT to_jsonb(s) || jsonb_build_object(
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
    AND public.store_visible(s.store_id)
    AND (p_store_id IS NULL OR s.store_id = p_store_id)
  ORDER BY s.opened_at DESC, s.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 1000);
$$;
REVOKE ALL ON FUNCTION public.shift_list_secure(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_list_secure(text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.shift_active_secure(p_store_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT secure_row
  FROM public.shift_list_secure(p_store_id, 1000) AS secure_rows(secure_row)
  WHERE secure_row->>'status' = 'OPEN' AND secure_row->>'closed_at' IS NULL
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.shift_active_secure(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_active_secure(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.shift_active_for_branch(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shift_active_for_branch(text) TO service_role;

DROP POLICY IF EXISTS "Staff raise transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Staff read transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Staff update transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Supervisors delete transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Staff read transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Staff write transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Branch staff write transfer items" ON public.stock_transfer_items;
DROP POLICY IF EXISTS "Scoped staff raise transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Scoped staff read transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Scoped staff update transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Scoped supervisors delete transfers" ON public.stock_transfers;
DROP POLICY IF EXISTS "Scoped staff access transfer items" ON public.stock_transfer_items;

CREATE POLICY "Scoped staff raise transfers" ON public.stock_transfers FOR INSERT TO authenticated
  WITH CHECK (public.has_perm('can_create_transfer') AND (public.user_has_store_access(from_store_id) OR public.user_has_store_access(to_store_id)));
CREATE POLICY "Scoped staff read transfers" ON public.stock_transfers FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())) AND (public.user_has_store_access(from_store_id) OR public.user_has_store_access(to_store_id)));
CREATE POLICY "Scoped staff update transfers" ON public.stock_transfers FOR UPDATE TO authenticated
  USING ((public.has_perm('can_create_transfer') OR public.has_perm('can_receive_transfer') OR public.has_perm('can_approve_transfer')) AND (public.user_has_store_access(from_store_id) OR public.user_has_store_access(to_store_id)))
  WITH CHECK ((public.has_perm('can_create_transfer') OR public.has_perm('can_receive_transfer') OR public.has_perm('can_approve_transfer')) AND (public.user_has_store_access(from_store_id) OR public.user_has_store_access(to_store_id)));
CREATE POLICY "Scoped supervisors delete transfers" ON public.stock_transfers FOR DELETE TO authenticated
  USING (public.is_supervisor_now() AND public.user_has_store_access(from_store_id));
CREATE POLICY "Scoped staff access transfer items" ON public.stock_transfer_items TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id=stock_transfer_items.transfer_id AND (public.user_has_store_access(t.from_store_id) OR public.user_has_store_access(t.to_store_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stock_transfers t WHERE t.id=stock_transfer_items.transfer_id AND (public.user_has_store_access(t.from_store_id) OR public.user_has_store_access(t.to_store_id))));
