-- Keep the existing visibility policy as the only SELECT policy.  Field-level
-- settings writes are restricted to authorized operators and their reserved
-- GLOBAL / pos_field:* namespace.
DROP POLICY IF EXISTS settings_scoped_pos_fields_write ON public.settings_scoped;
DROP POLICY IF EXISTS settings_scoped_pos_fields_insert ON public.settings_scoped;
DROP POLICY IF EXISTS settings_scoped_pos_fields_update ON public.settings_scoped;
DROP POLICY IF EXISTS settings_scoped_pos_fields_delete ON public.settings_scoped;

CREATE POLICY settings_scoped_pos_fields_insert ON public.settings_scoped FOR INSERT TO authenticated
  WITH CHECK (
    scope = 'GLOBAL' AND scope_id = '' AND key LIKE 'pos_field:%'
    AND public.has_perm('can_access_pos_settings')
  );

CREATE POLICY settings_scoped_pos_fields_update ON public.settings_scoped FOR UPDATE TO authenticated
  USING (
    scope = 'GLOBAL' AND scope_id = '' AND key LIKE 'pos_field:%'
    AND public.has_perm('can_access_pos_settings')
  )
  WITH CHECK (
    scope = 'GLOBAL' AND scope_id = '' AND key LIKE 'pos_field:%'
    AND public.has_perm('can_access_pos_settings')
  );

CREATE POLICY settings_scoped_pos_fields_delete ON public.settings_scoped FOR DELETE TO authenticated
  USING (
    scope = 'GLOBAL' AND scope_id = '' AND key LIKE 'pos_field:%'
    AND public.has_perm('can_access_pos_settings')
  );
