-- A terminal exception belongs to its registered token, not to the branch.
-- Revoke/reissue and deletion retire only that token's settings. The trigger
-- runs before the token changes so setting-delete feed events retain its branch.
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.cleanup_retired_terminal_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $cleanup$
DECLARE
  retire boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    retire := true;
  ELSE
    retire := NEW.status = 'revoked' AND
      (OLD.status IS DISTINCT FROM NEW.status OR OLD.revoked_at IS DISTINCT FROM NEW.revoked_at);
  END IF;
  IF retire THEN
    DELETE FROM public.settings_overrides
     WHERE lower(scope) = 'terminal' AND scope_id = OLD.id::text;
    DELETE FROM public.settings_scoped
     WHERE lower(scope) = 'terminal' AND scope_id = OLD.id::text;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$cleanup$;

REVOKE ALL ON FUNCTION private.cleanup_retired_terminal_settings()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cleanup_retired_terminal_settings_update ON public.terminal_tokens;
CREATE TRIGGER cleanup_retired_terminal_settings_update
BEFORE UPDATE OF status, revoked_at ON public.terminal_tokens
FOR EACH ROW EXECUTE FUNCTION private.cleanup_retired_terminal_settings();

DROP TRIGGER IF EXISTS cleanup_retired_terminal_settings_delete ON public.terminal_tokens;
CREATE TRIGGER cleanup_retired_terminal_settings_delete
BEFORE DELETE ON public.terminal_tokens
FOR EACH ROW EXECUTE FUNCTION private.cleanup_retired_terminal_settings();

-- Repair only unusable terminal-specific rows left by older releases.
DELETE FROM public.settings_overrides scoped
 WHERE lower(scoped.scope) = 'terminal'
   AND NOT EXISTS (
     SELECT 1 FROM public.terminal_tokens token
      WHERE token.id::text = scoped.scope_id
        AND token.status IN ('active', 'used') AND token.revoked_at IS NULL
   );
DELETE FROM public.settings_scoped scoped
 WHERE lower(scoped.scope) = 'terminal'
   AND NOT EXISTS (
     SELECT 1 FROM public.terminal_tokens token
      WHERE token.id::text = scoped.scope_id
        AND token.status IN ('active', 'used') AND token.revoked_at IS NULL
   );
