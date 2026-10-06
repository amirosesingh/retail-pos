-- A password sign-in is followed immediately by current_app_user(), and the
-- authenticated shell reads its own user_roles row. Some upgraded projects
-- retained tightened object ACLs after these objects/policies were recreated,
-- causing a valid Auth login to fail with SQLSTATE 42501 before its registered
-- terminal location could load.
--
-- Keep this repair deliberately narrow: authenticated users may execute the
-- SECURITY DEFINER self-profile routine and SELECT user_roles through its RLS
-- policies. No write privilege is restored.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_user() TO authenticated, service_role;
GRANT SELECT ON TABLE public.user_roles TO authenticated, service_role;

