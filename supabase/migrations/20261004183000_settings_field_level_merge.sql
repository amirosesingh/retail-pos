-- Independently version every physical POS settings field by storing its
-- authoritative value in the existing settings_scoped row-per-key model.
-- The application uses GLOBAL / pos_field:<column>; settings_scoped already
-- has timestamp-first revision normalization and bidirectional device sync.

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
