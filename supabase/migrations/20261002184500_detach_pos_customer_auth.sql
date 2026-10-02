-- The dedicated membership project owns customer identities and self-service.
-- The POS project keeps operational sale references only and must expose no
-- customer-authenticated membership entry points.

DROP POLICY IF EXISTS audit_logs_staff_insert ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_staff_read ON public.audit_logs;
DROP POLICY IF EXISTS payment_types_staff_read ON public.payment_types;
DROP POLICY IF EXISTS payment_types_staff_write ON public.payment_types;

-- Replace legacy authenticated=true policies with staff-scoped operational
-- access. Customer identities have moved out, but POS staff must retain their
-- audit and payment configuration capabilities.
CREATE POLICY audit_logs_staff_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_staff_now()));
CREATE POLICY audit_logs_staff_read ON public.audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.is_staff_now()));

DROP POLICY IF EXISTS payment_types_read ON public.payment_types;
CREATE POLICY payment_types_read ON public.payment_types
  FOR SELECT TO authenticated
  USING ((SELECT public.is_staff_now()));
DROP POLICY IF EXISTS payment_types_write ON public.payment_types;
CREATE POLICY payment_types_write ON public.payment_types
  TO authenticated
  USING (public.is_supervisor_now())
  WITH CHECK (public.is_supervisor_now());

REVOKE ALL ON FUNCTION public.member_welcome_claim(text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.membership_portal_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.membership_portal_enroll(text, text, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.membership_portal_enroll_details(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.membership_portal_update(text, text, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.membership_portal_update_details(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.membership_portal_sales(integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.members.auth_user_id IS
  'Deprecated POS-project customer auth link. New member identities exist only in the dedicated membership Supabase project.';

NOTIFY pgrst, 'reload schema';
