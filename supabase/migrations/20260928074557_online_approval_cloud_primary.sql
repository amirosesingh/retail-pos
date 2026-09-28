-- Supabase owns approval state whenever it can be reached. Offline rows use
-- the same UUID as their attempted cloud request and may only fill an absent
-- cloud row; they must never overwrite an approval/rejection that already
-- landed centrally.
CREATE OR REPLACE FUNCTION public.sync_apply_authorization_requests(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.authorization_requests (
    id, action_key, requested_by, requested_by_name, store_id, terminal_id,
    reason, payload, status, decided_by, decided_by_name, decided_at,
    decision_note, expires_at, consumed_at, requester_direct_limit, value_unit,
    created_at, updated_at, requested_amount, approved_amount, approved_payload,
    bill_snapshot, snapshot_hash, held_order_id, notified_at
  )
  SELECT
    id, action_key, requested_by, requested_by_name, store_id, terminal_id,
    reason, payload, status, decided_by, decided_by_name, decided_at,
    decision_note, expires_at, consumed_at, requester_direct_limit, value_unit,
    created_at, updated_at, requested_amount, approved_amount, approved_payload,
    bill_snapshot, snapshot_hash, held_order_id, notified_at
  FROM jsonb_populate_recordset(
    NULL::public.authorization_requests,
    COALESCE(p_rows, '[]'::jsonb)
  )
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

-- Audit rows are append-only logical events. Replaying an offline batch with
-- the same event UUID is a no-op rather than a second approval audit entry.
CREATE OR REPLACE FUNCTION public.sync_apply_authorization_log(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.authorization_log (
    id, action_key, mode_used, request_id, requested_by, authorized_by,
    authorizer_role, store_id, terminal_id, outcome, detail, created_at
  )
  SELECT
    id, action_key, mode_used, request_id, requested_by, authorized_by,
    authorizer_role, store_id, terminal_id, outcome, detail, created_at
  FROM jsonb_populate_recordset(
    NULL::public.authorization_log,
    COALESCE(p_rows, '[]'::jsonb)
  )
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_apply_authorization_requests(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_apply_authorization_log(jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'authorization_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.authorization_requests;
  END IF;
END
$$;
