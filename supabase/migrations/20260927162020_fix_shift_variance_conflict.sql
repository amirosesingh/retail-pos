-- PostgreSQL can only infer ON CONFLICT (reconciliation_id) from a full
-- unique index. The former partial index required the same WHERE predicate in
-- every caller and caused shift_reconcile_now() to fail with SQLSTATE 42P10.
-- A normal unique index still permits multiple NULL values, so this preserves
-- the original data model while making the existing idempotent insert valid.
DROP INDEX IF EXISTS public.shift_variance_alerts_recon_uidx;

CREATE UNIQUE INDEX shift_variance_alerts_recon_uidx
  ON public.shift_variance_alerts (reconciliation_id);
