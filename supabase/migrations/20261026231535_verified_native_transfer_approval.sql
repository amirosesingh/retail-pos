-- A native PIN session is verified by the POS relay, not an Auth JWT. Keep its
-- account context confined to this approval transaction and this transfer.
BEGIN;
CREATE OR REPLACE FUNCTION private.native_transfer_approver(p_transfer_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT a.id FROM public.app_users a
   WHERE auth.role() = 'service_role'
     AND current_setting('pos.native_approval_transfer', true) = p_transfer_id::text
     AND a.user_id = current_setting('pos.native_approval_staff', true)
     AND a.is_active
     AND a.permissions->'can_approve_transfer' = 'true'::jsonb
   LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION private.native_transfer_approver(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.native_transfer_approver(uuid) TO service_role;

-- Reuse the existing policy for both Auth and the narrowly scoped native call.
DO $policy$
DECLARE definition text; old_actor text := 'SELECT * INTO u FROM public.current_app_user();';
BEGIN
  SELECT pg_get_functiondef('public.may_approve_cross_group_transfer()'::regprocedure) INTO definition;
  IF position(old_actor IN definition) > 0 THEN
    definition := replace(definition, old_actor,
      'IF auth.role() = ''service_role'' AND NULLIF(current_setting(''pos.native_approval_transfer'', true), '''') IS NOT NULL THEN
         SELECT a.id,a.user_id,a.full_name,a.role,a.store_id,a.email,a.permissions,a.is_active INTO u
           FROM public.app_users a WHERE a.id = private.native_transfer_approver(current_setting(''pos.native_approval_transfer'', true)::uuid);
       ELSE SELECT * INTO u FROM public.current_app_user(); END IF;');
    definition := replace(definition, 'OR NOT public.has_perm(''can_approve_transfer'')',
      'OR NOT (CASE WHEN auth.role() = ''service_role'' THEN COALESCE(u.permissions->''can_approve_transfer'' = ''true''::jsonb,false) ELSE public.has_perm(''can_approve_transfer'') END)');
    EXECUTE definition;
  ELSIF position('private.native_transfer_approver' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected configured transfer approver policy not found';
  END IF;
END $policy$;

-- Preserve every existing lifecycle guard; extend only its approval authority
-- check to the actor proven for this exact transfer by the service-only RPC.
DO $lifecycle$
DECLARE definition text; old_check text := 'OR public.has_perm(''can_approve_transfer'');';
BEGIN
 SELECT pg_get_functiondef('public.stock_transfers_enforce_lifecycle()'::regprocedure) INTO definition;
 IF position(old_check IN definition)>0 THEN
   EXECUTE replace(definition, old_check,
     'OR public.has_perm(''can_approve_transfer'') OR private.native_transfer_approver(NEW.id) IS NOT NULL;');
 ELSIF position('private.native_transfer_approver(NEW.id)' IN definition)=0 THEN
   RAISE EXCEPTION 'Expected transfer lifecycle approval check not found';
 END IF;
END $lifecycle$;

CREATE OR REPLACE FUNCTION public.stock_transfer_approve_for_staff(
 p_transfer_id uuid, p_staff_user_id text, p_bound_store_id text DEFAULT NULL, p_lines jsonb DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
 a public.app_users; t public.stock_transfers;
 actor text;
 previous_staff text := current_setting('pos.native_approval_staff',true);
 previous_transfer text := current_setting('pos.native_approval_transfer',true);
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'Verified native staff session required' USING ERRCODE='insufficient_privilege';
 END IF;
 SELECT * INTO a FROM public.app_users WHERE user_id=p_staff_user_id FOR SHARE;
 IF a.id IS NULL OR NOT a.is_active OR a.permissions->'can_approve_transfer' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'Active transfer approver permission required' USING ERRCODE='insufficient_privilege';
 END IF;
 SELECT * INTO t FROM public.stock_transfers WHERE id=p_transfer_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND_OR_UNAVAILABLE'; END IF;
 IF (NULLIF(p_bound_store_id,'') IS NOT NULL AND p_bound_store_id<>t.from_store_id)
    OR (a.store_id IS NOT NULL AND a.store_id<>t.from_store_id)
    OR (NULLIF(p_bound_store_id,'') IS NULL AND a.store_id IS NULL
        AND a.role::text NOT IN ('admin','manager') AND COALESCE(a.role_slug,'') NOT IN ('admin','supervisor')) THEN
   RAISE EXCEPTION 'You cannot approve transfers for this sending location' USING ERRCODE='insufficient_privilege';
 END IF;
 IF t.status<>'awaiting_approval' THEN RAISE EXCEPTION 'Transfer is not waiting for approval'; END IF;
 actor := COALESCE(NULLIF(btrim(a.full_name),''),a.user_id);
 PERFORM set_config('pos.native_approval_staff',a.user_id,true);
 PERFORM set_config('pos.native_approval_transfer',t.id::text,true);
 IF public.is_cross_group_transfer(t.from_store_id,t.to_store_id) THEN
   IF NOT public.may_approve_cross_group_transfer()
      OR lower(btrim(COALESCE(t.created_by,''))) IN (lower(actor),lower(a.user_id),lower(a.id::text)) THEN
     RAISE EXCEPTION 'Independent configured cross-cluster approver required' USING ERRCODE='insufficient_privilege';
   END IF;
 END IF;
 -- Same quantity approval semantics as the existing approval routine. No stock
 -- is posted here; dispatch, receipt and verification retain their routines.
 UPDATE public.stock_transfer_items i SET quantity_approved=COALESCE(
   (SELECT (l->>'qty')::int FROM jsonb_array_elements(COALESCE(p_lines,'[]'::jsonb)) l
     WHERE l->>'product_id'=i.product_id::text LIMIT 1),i.quantity)
 WHERE i.transfer_id=t.id;
 UPDATE public.stock_transfers SET status='approved',approved_by=actor,approved_at=now() WHERE id=t.id;
 PERFORM set_config('pos.native_approval_staff',COALESCE(previous_staff,''),true);
 PERFORM set_config('pos.native_approval_transfer',COALESCE(previous_transfer,''),true);
END $fn$;
REVOKE ALL ON FUNCTION public.stock_transfer_approve_for_staff(uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stock_transfer_approve_for_staff(uuid,text,text,jsonb) TO service_role;
COMMIT;
