-- Align store-group writes with the same explicit permission used by the
-- locations screen, relay, and stores policies. Administrators continue to
-- pass has_perm(), while custom roles can be granted this responsibility.
DROP POLICY IF EXISTS "Supervisors manage store groups" ON public.store_groups;
CREATE POLICY "Supervisors manage store groups" ON public.store_groups
  FOR INSERT TO authenticated
  WITH CHECK (public.has_perm('can_manage_locations'));

DROP POLICY IF EXISTS "Supervisors update store groups" ON public.store_groups;
CREATE POLICY "Supervisors update store groups" ON public.store_groups
  FOR UPDATE TO authenticated
  USING (public.has_perm('can_manage_locations'))
  WITH CHECK (public.has_perm('can_manage_locations'));
