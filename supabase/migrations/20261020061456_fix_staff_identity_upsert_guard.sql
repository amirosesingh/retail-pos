-- BEFORE INSERT runs before ON CONFLICT (user_id) updates the existing row.
-- Legacy staff profile IDs can differ from their Auth IDs. Treat that proposed
-- insert as the same identity only when both the exact conflict key and the
-- non-null Auth identity match; keep rejecting aliases owned by other users.
CREATE OR REPLACE FUNCTION public.guard_staff_login_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_temp AS $$
DECLARE alias_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-login-identities', 0));
  NEW.login_username := nullif(lower(trim(NEW.login_username)), '');
  alias_name := coalesce(NEW.login_username, lower(NEW.user_id));
  IF NEW.login_username IS NOT NULL AND NEW.login_username <> lower(NEW.user_id)
     AND NEW.login_username !~ '^[a-z0-9._-]{2,40}$' THEN
    RAISE EXCEPTION 'STAFF_LOGIN_USERNAME_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.app_users a
    WHERE a.id IS DISTINCT FROM NEW.id
      AND NOT (
        TG_OP = 'INSERT'
        AND a.user_id = NEW.user_id
        AND NEW.auth_user_id IS NOT NULL
        AND a.auth_user_id IS NOT DISTINCT FROM NEW.auth_user_id
      )
      AND (lower(a.user_id) IN (alias_name, lower(NEW.user_id))
        OR lower(a.login_username) IN (alias_name, lower(NEW.user_id)))
  ) THEN
    RAISE EXCEPTION 'That username is already in use' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_staff_login_identity() FROM PUBLIC, anon, authenticated;
