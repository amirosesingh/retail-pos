-- Existing personal-settings policies call this helper as authenticated.
-- It returns only the caller's own owner key; row ownership checks remain intact.
GRANT EXECUTE ON FUNCTION public.settings_private_key() TO authenticated;
