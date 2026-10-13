-- Match the uppercase scope contract already used by the application and
-- SQL Server registry. Keep branch ownership and all RLS policies unchanged.
ALTER TABLE public.settings_scoped
  DROP CONSTRAINT IF EXISTS settings_scoped_scope_check;
ALTER TABLE public.settings_scoped
  ADD CONSTRAINT settings_scoped_scope_check
  CHECK (scope IN ('GLOBAL', 'CLUSTER', 'BRANCH', 'TERMINAL'));
