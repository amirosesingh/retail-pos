-- Store ids in the POS schema are text. This legacy UUID overload used the
-- unrelated store_users model and contradicted the app_users contract where a
-- NULL store_id means company-wide access.
DROP FUNCTION IF EXISTS public.user_has_store_access(uuid);

CREATE OR REPLACE FUNCTION public.current_app_user()
RETURNS TABLE(id uuid, user_id text, full_name text, role public.app_role,
              store_id text, email text, permissions jsonb, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT a.id, a.user_id::text, a.full_name::text, a.role, a.store_id::text,
         a.email::text, a.permissions, a.is_active
  FROM public.app_users a
  WHERE a.auth_user_id = (SELECT auth.uid())
     OR lower(a.email) = lower(coalesce((SELECT auth.jwt()) ->> 'email', ''))
  LIMIT 1
$$;

DROP POLICY IF EXISTS "Users can read their own staff record" ON public.app_users;
CREATE POLICY "Users can read their own staff record"
ON public.app_users FOR SELECT TO authenticated
USING (auth_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can read their own roles" ON public.user_roles;
CREATE POLICY "Users can read their own roles"
ON public.user_roles FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles"
ON public.user_roles TO authenticated
USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
