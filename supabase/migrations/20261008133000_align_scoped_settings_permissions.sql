-- Match the database authorization boundary to the settings pages. Delegated
-- custom roles with can_access_pos_settings may manage only scopes they can
-- see; ordinary authenticated staff retain read-only access.
CREATE OR REPLACE FUNCTION public.settings_scope_manageable(p_scope text, p_scope_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE lower(COALESCE(p_scope,''))
    WHEN 'global' THEN public.has_perm('can_access_pos_settings')
    WHEN 'private' THEN p_scope_id = public.settings_private_key()
    ELSE public.has_perm('can_access_pos_settings')
         AND public.settings_scope_visible(p_scope,p_scope_id)
  END
$$;

REVOKE ALL ON FUNCTION public.settings_scope_manageable(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settings_scope_manageable(text,text)
  TO authenticated, service_role;

DROP POLICY IF EXISTS "Staff can insert" ON public.pos_settings;
DROP POLICY IF EXISTS "Staff can update" ON public.pos_settings;
DROP POLICY IF EXISTS "Staff can delete" ON public.pos_settings;
DROP POLICY IF EXISTS "Settings managers can insert" ON public.pos_settings;
DROP POLICY IF EXISTS "Settings managers can update" ON public.pos_settings;
DROP POLICY IF EXISTS "Settings managers can delete" ON public.pos_settings;

CREATE POLICY "Settings managers can insert" ON public.pos_settings
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_perm('can_access_pos_settings')));
CREATE POLICY "Settings managers can update" ON public.pos_settings
  FOR UPDATE TO authenticated
  USING ((SELECT public.has_perm('can_access_pos_settings')))
  WITH CHECK ((SELECT public.has_perm('can_access_pos_settings')));
CREATE POLICY "Settings managers can delete" ON public.pos_settings
  FOR DELETE TO authenticated
  USING ((SELECT public.has_perm('can_access_pos_settings')));

NOTIFY pgrst, 'reload schema';
