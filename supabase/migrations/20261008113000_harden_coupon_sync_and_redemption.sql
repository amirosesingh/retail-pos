-- Preserve the transfer authority repairs while this release is rolled out.
CREATE OR REPLACE FUNCTION public.stock_transfer_approval_required(_store_id text, _to_store_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT CASE
    WHEN public.is_cross_group_transfer(_store_id,_to_store_id) THEN true
    ELSE COALESCE(
      (SELECT false FROM public.authorization_actions a
        WHERE a.action_key='stock_transfer' AND a.is_enabled
          AND ((a.scope_type='branch' AND a.scope_id=_store_id)
            OR (a.scope_type='global' AND a.scope_id=''))
        ORDER BY CASE WHEN a.scope_type='branch' THEN 0 ELSE 1 END LIMIT 1),
      public.stock_transfer_approval_required(_store_id)
    )
  END
$fn$;

DO $verify_transfer_authority$
BEGIN
  IF pg_get_functiondef('public.stock_transfers_enforce_lifecycle()'::regprocedure)
       ILIKE '%can_receive_transfer%' THEN
    RAISE EXCEPTION 'Transfer approval authority still includes receiving permission';
  END IF;
END
$verify_transfer_authority$;

-- Vouchers are organization-wide.  store_id records the redemption location;
-- an unredeemed voucher has no branch yet and must still reach every till.
CREATE OR REPLACE FUNCTION public.sync_feed_issued_vouchers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  INSERT INTO public.sync_change_feed(
    organization_id,branch_id,terminal_id,table_name,entity_id,operation,row_version,tombstone
  ) VALUES (
    'default','global',NULL,'issued_vouchers',
    CASE WHEN TG_OP='DELETE' THEN jsonb_build_object('id',OLD.id)::text
         ELSE jsonb_build_object('id',NEW.id)::text END,
    lower(TG_OP),COALESCE(NEW.row_version,OLD.row_version,1),TG_OP='DELETE'
  );
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.sync_feed_issued_vouchers() FROM PUBLIC, anon, authenticated;

-- Keep the mature bootstrap/count implementations intact and wrap only the
-- issued_vouchers case. This avoids regenerating unrelated table contracts.
DO $bootstrap_wrapper$
BEGIN
  IF to_regprocedure('public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer)') IS NULL THEN
    ALTER FUNCTION public.pos_sync_bootstrap(text,text,text,text,text,integer,integer)
      RENAME TO pos_sync_bootstrap_scoped;
  END IF;
END
$bootstrap_wrapper$;
CREATE OR REPLACE FUNCTION public.pos_sync_bootstrap(
  p_organization_id text,p_branch_id text,p_terminal_id text,p_table text,
  p_after_cursor text DEFAULT NULL,p_history_days integer DEFAULT 90,p_limit integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_rows jsonb:='[]'::jsonb; v_cursor text; v_me public.app_users%ROWTYPE;
BEGIN
  IF p_table <> 'issued_vouchers' THEN
    RETURN public.pos_sync_bootstrap_scoped(
      p_organization_id,p_branch_id,p_terminal_id,p_table,p_after_cursor,p_history_days,p_limit
    );
  END IF;
  PERFORM public.pos_sync_validate_scope(p_organization_id,p_branch_id,p_terminal_id);
  IF auth.role()<>'service_role' THEN
    SELECT * INTO v_me FROM public.app_users
      WHERE auth_user_id=auth.uid() AND is_active=true LIMIT 1;
    IF v_me.id IS NULL OR NOT (
      v_me.role='admin' OR COALESCE((v_me.permissions->>'can_manage_sync_backup')::boolean,false)
    ) THEN RAISE EXCEPTION 'SYNC_FORBIDDEN'; END IF;
    IF NOT (v_me.role='admin' OR v_me.store_id IS NULL OR v_me.store_id=p_branch_id) THEN
      RAISE EXCEPTION 'SYNC_BRANCH_FORBIDDEN';
    END IF;
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(page.row_data) ORDER BY page.cursor),'[]'::jsonb),
         max(page.cursor)
    INTO v_rows,v_cursor
    FROM (
      SELECT jsonb_build_object('id',x.id)::text cursor,x row_data
      FROM public.issued_vouchers x
      WHERE p_after_cursor IS NULL OR jsonb_build_object('id',x.id)::text>p_after_cursor
      ORDER BY jsonb_build_object('id',x.id)::text
      LIMIT LEAST(GREATEST(p_limit,100),2000)
    ) page;
  RETURN jsonb_build_object(
    'rows',v_rows,
    'cursor',CASE WHEN jsonb_array_length(v_rows)>=LEAST(GREATEST(p_limit,100),2000)
                  THEN v_cursor ELSE NULL END
  );
END $fn$;

DO $counts_wrapper$
BEGIN
  IF to_regprocedure('public.pos_sync_counts_scoped(text,text,text,integer)') IS NULL THEN
    ALTER FUNCTION public.pos_sync_counts(text,text,text,integer) RENAME TO pos_sync_counts_scoped;
  END IF;
END
$counts_wrapper$;
CREATE OR REPLACE FUNCTION public.pos_sync_counts(
  p_organization_id text,p_branch_id text,p_terminal_id text,p_history_days integer DEFAULT 90
) RETURNS TABLE(table_name text,row_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  RETURN QUERY
    SELECT scoped.table_name,scoped.row_count
    FROM public.pos_sync_counts_scoped(
      p_organization_id,p_branch_id,p_terminal_id,p_history_days
    ) scoped
    WHERE scoped.table_name <> 'issued_vouchers'
    UNION ALL
    SELECT 'issued_vouchers'::text,count(*)::bigint FROM public.issued_vouchers;
END $fn$;

REVOKE ALL ON FUNCTION public.pos_sync_bootstrap_scoped(text,text,text,text,text,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_bootstrap(text,text,text,text,text,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_counts_scoped(text,text,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pos_sync_counts(text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pos_sync_bootstrap(text,text,text,text,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_sync_counts(text,text,text,integer) TO service_role;

-- Campaign administration is a permission, not merely proof of staff status.
DROP POLICY IF EXISTS campaigns_staff_insert ON public.coupon_campaigns;
DROP POLICY IF EXISTS campaigns_staff_update ON public.coupon_campaigns;
DROP POLICY IF EXISTS campaigns_staff_delete ON public.coupon_campaigns;
CREATE POLICY campaigns_staff_insert ON public.coupon_campaigns
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_perm('can_manage_promotions')));
CREATE POLICY campaigns_staff_update ON public.coupon_campaigns
  FOR UPDATE TO authenticated USING ((SELECT public.has_perm('can_manage_promotions')))
  WITH CHECK ((SELECT public.has_perm('can_manage_promotions')));
CREATE POLICY campaigns_staff_delete ON public.coupon_campaigns
  FOR DELETE TO authenticated USING ((SELECT public.has_perm('can_manage_promotions')));

DROP POLICY IF EXISTS vouchers_staff_insert ON public.issued_vouchers;
DROP POLICY IF EXISTS vouchers_staff_update ON public.issued_vouchers;
DROP POLICY IF EXISTS vouchers_staff_delete ON public.issued_vouchers;
CREATE POLICY vouchers_staff_insert ON public.issued_vouchers
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_perm('can_manage_promotions')));
CREATE POLICY vouchers_staff_update ON public.issued_vouchers
  FOR UPDATE TO authenticated USING ((SELECT public.has_perm('can_manage_promotions')))
  WITH CHECK ((SELECT public.has_perm('can_manage_promotions')));
CREATE POLICY vouchers_staff_delete ON public.issued_vouchers
  FOR DELETE TO authenticated USING ((SELECT public.has_perm('can_manage_promotions')));

CREATE OR REPLACE FUNCTION public.coupon_issue_manual(
  _slug text,_phone text,_full_name text DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL,_staff text DEFAULT NULL,
  _role text DEFAULT NULL,_store text DEFAULT NULL,_ignore_limit boolean DEFAULT false
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE _c public.coupon_campaigns; _member uuid; _token text; _held integer;
BEGIN
  IF NOT public.has_perm('can_manage_promotions') THEN RAISE EXCEPTION 'PERMISSION_DENIED_PROMOTIONS'; END IF;
  SELECT * INTO _c FROM public.coupon_campaigns WHERE slug=_slug FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND'; END IF;
  IF NOT _c.is_active THEN RAISE EXCEPTION 'CAMPAIGN_INACTIVE'; END IF;
  IF _c.starts_at IS NOT NULL AND now()<_c.starts_at THEN RAISE EXCEPTION 'CAMPAIGN_NOT_STARTED'; END IF;
  IF _c.expires_at IS NOT NULL AND now()>_c.expires_at THEN RAISE EXCEPTION 'CAMPAIGN_EXPIRED'; END IF;
  IF _c.max_claims IS NOT NULL AND _c.claims_count>=_c.max_claims THEN RAISE EXCEPTION 'CAMPAIGN_FULLY_CLAIMED'; END IF;
  _member:=public.member_join(_phone,_full_name,NULL);
  SELECT count(*) INTO _held FROM public.issued_vouchers WHERE campaign_id=_c.id AND member_id=_member;
  IF NOT _ignore_limit AND _c.max_per_member IS NOT NULL AND _held>=_c.max_per_member THEN
    PERFORM public.coupon_log('BLOCKED',_c,NULL,_member,_phone,_store,NULL,_staff,_role,NULL,'Manual issue blocked by per-member limit');
    RAISE EXCEPTION 'MEMBER_LIMIT_REACHED';
  END IF;
  _token:=public.voucher_token();
  INSERT INTO public.issued_vouchers(token_slug,campaign_id,member_id,expires_at,issued_by,issued_source)
    VALUES(_token,_c.id,_member,_expires_at,_staff,'MANUAL');
  UPDATE public.coupon_campaigns SET claims_count=claims_count+1 WHERE id=_c.id;
  PERFORM public.coupon_log('ISSUED_MANUAL',_c,_token,_member,_phone,_store,NULL,_staff,_role,NULL,
    CASE WHEN _expires_at IS NULL THEN NULL ELSE 'Custom expiry' END);
  RETURN _token;
END $fn$;

CREATE OR REPLACE FUNCTION public.voucher_redeem(
  _token text,_sale_id text DEFAULT NULL,_store_id text DEFAULT NULL,_staff text DEFAULT NULL
) RETURNS public.issued_vouchers LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE _v public.issued_vouchers; _c public.coupon_campaigns; _actor record; _deadline timestamptz;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'Only staff can redeem a voucher'; END IF;
  SELECT * INTO _actor FROM public.current_app_user();
  IF _actor.id IS NULL OR NULLIF(btrim(_store_id),'') IS NULL OR NOT (
    public.is_app_supervisor() OR _actor.store_id IS NULL OR _actor.store_id=_store_id
  ) THEN RAISE EXCEPTION 'VOUCHER_BRANCH_FORBIDDEN'; END IF;
  SELECT * INTO _v FROM public.issued_vouchers WHERE token_slug=_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOUCHER_NOT_FOUND'; END IF;
  IF _v.status='REDEEMED' THEN RAISE EXCEPTION 'VOUCHER_ALREADY_REDEEMED'; END IF;
  IF _v.status='DISABLED' THEN RAISE EXCEPTION 'VOUCHER_DISABLED'; END IF;
  IF _v.status<>'ISSUED' THEN RAISE EXCEPTION 'VOUCHER_EXPIRED'; END IF;
  SELECT * INTO _c FROM public.coupon_campaigns WHERE id=_v.campaign_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND'; END IF;
  IF NOT _c.is_active THEN RAISE EXCEPTION 'CAMPAIGN_INACTIVE'; END IF;
  IF _c.starts_at IS NOT NULL AND now()<_c.starts_at THEN RAISE EXCEPTION 'CAMPAIGN_NOT_STARTED'; END IF;
  _deadline:=coalesce(_v.expires_at,_c.expires_at);
  IF _deadline IS NOT NULL AND now()>_deadline THEN
    UPDATE public.issued_vouchers SET status='EXPIRED' WHERE id=_v.id;
    PERFORM public.coupon_log('BLOCKED',_c,_token,_v.member_id,NULL,_store_id,NULL,_staff,NULL,_sale_id,'Expired voucher presented');
    RAISE EXCEPTION 'VOUCHER_EXPIRED';
  END IF;
  UPDATE public.issued_vouchers SET status='REDEEMED',redeemed_at=now(),redeemed_by=_staff,
    redeemed_sale_id=_sale_id,store_id=_store_id WHERE id=_v.id AND status='ISSUED' RETURNING * INTO _v;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOUCHER_ALREADY_REDEEMED'; END IF;
  PERFORM public.coupon_log('REDEEMED',_c,_token,_v.member_id,NULL,_store_id,NULL,_staff,NULL,_sale_id);
  RETURN _v;
END $fn$;

CREATE OR REPLACE FUNCTION public.voucher_set_status(
  _token text,_status text,_reason text DEFAULT NULL,_staff text DEFAULT NULL,
  _role text DEFAULT NULL,_store text DEFAULT NULL
) RETURNS public.issued_vouchers LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE _v public.issued_vouchers; _c public.coupon_campaigns;
BEGIN
  IF NOT public.has_perm('can_manage_promotions') THEN RAISE EXCEPTION 'PERMISSION_DENIED_PROMOTIONS'; END IF;
  IF _status NOT IN ('ISSUED','DISABLED') THEN RAISE EXCEPTION 'VOUCHER_STATUS_INVALID'; END IF;
  SELECT * INTO _v FROM public.issued_vouchers WHERE token_slug=_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOUCHER_NOT_FOUND'; END IF;
  IF _v.status='REDEEMED' THEN RAISE EXCEPTION 'VOUCHER_ALREADY_REDEEMED'; END IF;
  SELECT * INTO _c FROM public.coupon_campaigns WHERE id=_v.campaign_id;
  UPDATE public.issued_vouchers SET status=_status,
    disabled_at=CASE WHEN _status='DISABLED' THEN now() ELSE NULL END,
    disabled_by=CASE WHEN _status='DISABLED' THEN _staff ELSE NULL END,
    disable_reason=CASE WHEN _status='DISABLED' THEN _reason ELSE NULL END
    WHERE id=_v.id RETURNING * INTO _v;
  PERFORM public.coupon_log(CASE WHEN _status='DISABLED' THEN 'DISABLED' ELSE 'REENABLED' END,
    _c,_token,_v.member_id,NULL,_store,NULL,_staff,_role,NULL,
    coalesce(_reason,CASE WHEN _status='DISABLED' THEN 'Disabled from backoffice' ELSE 'Re-enabled from backoffice' END));
  RETURN _v;
END $fn$;

NOTIFY pgrst,'reload schema';
