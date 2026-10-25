-- Account permissions are the editable authority. Preserve the current effective
-- matrices rather than restoring masked grants and unexpectedly widening access.
LOCK TABLE public.app_users IN SHARE ROW EXCLUSIVE MODE;
DROP TRIGGER IF EXISTS zz_global_permission_denials ON public.app_users;
DROP FUNCTION IF EXISTS public.set_global_permission_restrictions(text[]);
DROP FUNCTION IF EXISTS public.global_permission_restrictions();
DROP FUNCTION IF EXISTS private.enforce_global_permission_denials();
DROP TABLE IF EXISTS private.requested_staff_permissions;
DROP TABLE IF EXISTS private.global_permission_policy;
-- private.global_permission_audit remains private historical evidence.
NOTIFY pgrst, 'reload schema';
