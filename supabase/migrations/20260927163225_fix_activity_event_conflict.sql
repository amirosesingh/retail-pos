-- PostgREST and shift_reconcile_now() both target client_event_id directly in
-- ON CONFLICT clauses. Replace the partial index with an equivalent full
-- unique index so PostgreSQL can infer that conflict target. UNIQUE continues
-- to allow multiple NULL values, preserving the existing event model.
DROP INDEX IF EXISTS public.activity_events_client_event_id_key;

CREATE UNIQUE INDEX activity_events_client_event_id_key
  ON public.activity_events (client_event_id);
