-- Day-end summaries are a central, branch-scoped feature. The UI has always
-- published and listed them through the Data API, but the table was omitted
-- from the central installer.
CREATE TABLE IF NOT EXISTS public.shift_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  store_id text NOT NULL,
  store_name text NOT NULL DEFAULT '',
  terminal_name text NOT NULL DEFAULT '',
  closed_by text NOT NULL DEFAULT '',
  opened_at timestamptz NOT NULL,
  closed_at timestamptz NOT NULL,
  total_sales numeric NOT NULL DEFAULT 0,
  transactions integer NOT NULL DEFAULT 0,
  discounts numeric NOT NULL DEFAULT 0,
  refunds numeric NOT NULL DEFAULT 0,
  expected_cash numeric NOT NULL DEFAULT 0,
  counted_cash numeric NOT NULL DEFAULT 0,
  payment_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL DEFAULT '',
  channels text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shift_notifications_shift_key UNIQUE (shift_id)
);

CREATE INDEX IF NOT EXISTS shift_notifications_store_closed_idx
  ON public.shift_notifications (store_id, closed_at DESC);

ALTER TABLE public.shift_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_notifications FROM anon;
GRANT SELECT, INSERT ON public.shift_notifications TO authenticated;
GRANT ALL ON public.shift_notifications TO service_role;

DROP POLICY IF EXISTS "Branch staff publish shift summaries" ON public.shift_notifications;
CREATE POLICY "Branch staff publish shift summaries" ON public.shift_notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff_now() AND public.store_visible(store_id));

DROP POLICY IF EXISTS "Variance viewers read shift summaries" ON public.shift_notifications;
CREATE POLICY "Variance viewers read shift summaries" ON public.shift_notifications
  FOR SELECT TO authenticated
  USING (public.has_perm('can_shift_variance_view') AND public.store_visible(store_id));
