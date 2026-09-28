-- Restore the per-cashier idle override used by the supervisor settings UI.
-- NULL means the cashier inherits the branch/global timeout.
ALTER TABLE public.cashiers
  ADD COLUMN IF NOT EXISTS idle_timeout_minutes integer;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cashiers'::regclass
      AND conname = 'cashiers_idle_timeout_minutes_check'
  ) THEN
    ALTER TABLE public.cashiers
      ADD CONSTRAINT cashiers_idle_timeout_minutes_check
      CHECK (idle_timeout_minutes IS NULL OR idle_timeout_minutes BETWEEN 1 AND 1440);
  END IF;
END
$constraint$;

-- Keep the protected synchronization contract aware of the new column.
CREATE OR REPLACE FUNCTION public.sync_apply_cashiers(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.cashiers (
    id, username, full_name, pin_hash, store_id, permissions, is_active,
    last_login_at, created_at, updated_at, role_slug, idle_timeout_minutes
  )
  SELECT
    id, username, full_name, pin_hash, store_id, permissions, is_active,
    last_login_at, created_at, updated_at, role_slug, idle_timeout_minutes
  FROM jsonb_populate_recordset(NULL::public.cashiers, COALESCE(p_rows, '[]'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    full_name = EXCLUDED.full_name,
    pin_hash = EXCLUDED.pin_hash,
    store_id = EXCLUDED.store_id,
    permissions = EXCLUDED.permissions,
    is_active = EXCLUDED.is_active,
    last_login_at = EXCLUDED.last_login_at,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at,
    role_slug = EXCLUDED.role_slug,
    idle_timeout_minutes = EXCLUDED.idle_timeout_minutes;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

REVOKE ALL ON FUNCTION public.sync_apply_cashiers(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_apply_cashiers(jsonb) TO service_role;

-- Activity events remain immutable except for the per-user cleared marker.
-- Accept an identical value as well so repeated clear requests are idempotent.
CREATE OR REPLACE FUNCTION public.activity_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'cleared_by') = (to_jsonb(OLD) - 'cleared_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'activity_events rows cannot be %', TG_OP;
END
$fn$;
