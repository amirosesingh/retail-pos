-- Repair environments where the customer-auth detachment migration already
-- ran. This is policy-only and does not alter or rewrite table data.
DROP POLICY IF EXISTS audit_logs_staff_insert ON public.audit_logs;
CREATE POLICY audit_logs_staff_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_staff_now()));

DROP POLICY IF EXISTS audit_logs_staff_read ON public.audit_logs;
CREATE POLICY audit_logs_staff_read ON public.audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT public.is_staff_now()));

DROP POLICY IF EXISTS payment_types_staff_read ON public.payment_types;
DROP POLICY IF EXISTS payment_types_staff_write ON public.payment_types;
DROP POLICY IF EXISTS payment_types_read ON public.payment_types;
CREATE POLICY payment_types_read ON public.payment_types
  FOR SELECT TO authenticated
  USING ((SELECT public.is_staff_now()));

DROP POLICY IF EXISTS payment_types_write ON public.payment_types;
CREATE POLICY payment_types_write ON public.payment_types
  TO authenticated
  USING (public.is_supervisor_now())
  WITH CHECK (public.is_supervisor_now());
