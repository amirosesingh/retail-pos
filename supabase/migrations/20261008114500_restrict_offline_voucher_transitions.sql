-- Offline tills may redeem an existing voucher, but may not mint, re-enable,
-- reassign or delete organization-wide voucher records through synchronization.
CREATE OR REPLACE FUNCTION public.sync_apply_issued_vouchers(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE
  v_count integer:=0;
  v_row jsonb;
  v_existing public.issued_vouchers%ROWTYPE;
  v_branch text;
BEGIN
  SELECT location_id INTO v_branch
    FROM public.terminal_tokens
   WHERE id::text=current_setting('pos.sync_terminal',true)
     AND status IN ('active','used') AND revoked_at IS NULL
   LIMIT 1;
  IF NULLIF(v_branch,'') IS NULL THEN RAISE EXCEPTION 'SYNC_TERMINAL_SCOPE_FORBIDDEN'; END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) LOOP
    IF COALESCE(v_row->>'status','')<>'REDEEMED'
       OR v_row->>'store_id' IS DISTINCT FROM v_branch THEN
      RAISE EXCEPTION 'SYNC_VOUCHER_TRANSITION_FORBIDDEN';
    END IF;
    SELECT * INTO v_existing FROM public.issued_vouchers
     WHERE id=(v_row->>'id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_VOUCHER_UNKNOWN'; END IF;

    IF v_existing.status='REDEEMED' THEN
      IF v_existing.store_id IS DISTINCT FROM v_row->>'store_id'
         OR v_existing.redeemed_sale_id IS DISTINCT FROM v_row->>'redeemed_sale_id' THEN
        RAISE EXCEPTION 'VOUCHER_ALREADY_REDEEMED';
      END IF;
      CONTINUE;
    END IF;

    IF v_existing.status<>'ISSUED' OR NOT EXISTS(
      SELECT 1 FROM public.coupon_campaigns c
       WHERE c.id=v_existing.campaign_id AND c.is_active
         AND (c.starts_at IS NULL OR c.starts_at<=now())
         AND (COALESCE(v_existing.expires_at,c.expires_at) IS NULL
           OR COALESCE(v_existing.expires_at,c.expires_at)>=now())
    ) THEN RAISE EXCEPTION 'SYNC_VOUCHER_UNAVAILABLE'; END IF;

    UPDATE public.issued_vouchers
       SET status='REDEEMED',
           redeemed_at=COALESCE((v_row->>'redeemed_at')::timestamptz,now()),
           redeemed_by=NULLIF(v_row->>'redeemed_by',''),
           redeemed_sale_id=NULLIF(v_row->>'redeemed_sale_id',''),
           store_id=v_branch,
           row_version=GREATEST(
             v_existing.row_version+1,COALESCE((v_row->>'row_version')::integer,1)
           )
     WHERE id=v_existing.id;
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END $fn$;

CREATE OR REPLACE FUNCTION public.sync_delete_issued_vouchers(
  p_changes jsonb,p_branch_id text,p_terminal_id text
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER AS $fn$
BEGIN
  RETURN 0;
END $fn$;

REVOKE ALL ON FUNCTION public.sync_apply_issued_vouchers(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delete_issued_vouchers(jsonb,text,text) FROM PUBLIC;

NOTIFY pgrst,'reload schema';
