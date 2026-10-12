CREATE OR REPLACE FUNCTION public.pos_admin_correct_tender(p_sale uuid, p_store text, p_method text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE bill public.sales%ROWTYPE; new_payments jsonb;
BEGIN
 IF p_method IS NULL OR p_method !~ '^[a-z][a-z0-9_]{0,63}$' THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
 SELECT * INTO bill FROM public.sales WHERE id=p_sale AND lower(store_id)=lower(p_store) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'The bill was not found in this branch. Synchronize and retry.'; END IF;
 IF bill.is_refunded THEN RAISE EXCEPTION 'A refunded bill cannot have its payment corrected'; END IF;
 IF jsonb_typeof(bill.payments)='array' THEN
  SELECT coalesce(jsonb_agg(value || jsonb_build_object('method',p_method) ORDER BY ordinal), '[]'::jsonb)
  INTO new_payments FROM jsonb_array_elements(bill.payments) WITH ORDINALITY entries(value,ordinal);
 ELSE new_payments := bill.payments; END IF;
 UPDATE public.sales SET payment_type=p_method, payments=new_payments, row_version=coalesce(row_version,0)+1 WHERE id=p_sale;
 UPDATE public.payment_transactions SET method=p_method, row_version=coalesce(row_version,0)+1
 WHERE sale_id=p_sale AND source_type='sale' AND lower(store_id)=lower(p_store);
END $$;
REVOKE ALL ON FUNCTION public.pos_admin_correct_tender(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_admin_correct_tender(uuid,text,text) TO service_role;
DROP POLICY IF EXISTS "Branch staff read shift sessions" ON public.shift_sessions;
CREATE POLICY "Branch staff read shift sessions" ON public.shift_sessions FOR SELECT TO authenticated
USING (public.is_staff_now() AND public.store_visible(store_id) AND
(public.settings_admin_now() OR coalesce((SELECT (a.permissions->>'can_shift_signin_history_view')::boolean FROM public.current_app_user() a LIMIT 1),false)));
