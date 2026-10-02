-- Follow-up for review gaps found after the preceding migrations were deployed.
-- Existing financial and catalogue history remains intact.

CREATE OR REPLACE FUNCTION public.backfill_zero_stock_catalog_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(COALESCE(NEW.integration_settings ->> 'autoArchiveZeroStock', 'true')) = 'true'
     AND lower(COALESCE(OLD.integration_settings ->> 'autoArchiveZeroStock', 'true')) <> 'true' THEN
    WITH stock_state AS (
      SELECT p.id,
             COALESCE(sum(e.value::numeric) FILTER (
               WHERE e.value ~ '^-?[0-9]+([.][0-9]+)?$'
             ), 0) > 0 AS has_stock
        FROM public.products p
        LEFT JOIN LATERAL jsonb_each_text(p.stock_by_store) e ON true
       WHERE jsonb_typeof(p.stock_by_store) = 'object'
       GROUP BY p.id
    )
    UPDATE public.products p
       SET is_archived = true,
           archived_at = COALESCE(p.archived_at, now())
      FROM stock_state
     WHERE p.id = stock_state.id
       AND NOT stock_state.has_stock
       AND (NOT COALESCE(p.is_archived, false) OR p.archived_at IS NULL);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_zero_stock_catalog_lifecycle() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pos_sale_commit(
  _sale jsonb,
  _items jsonb DEFAULT '[]'::jsonb,
  _payments jsonb DEFAULT '[]'::jsonb,
  _movements jsonb DEFAULT '[]'::jsonb,
  _member jsonb DEFAULT NULL,
  _exchange_bill text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  s jsonb := COALESCE(_sale, '{}'::jsonb);
  entry jsonb;
  existing_id uuid;
  movement_result record;
BEGIN
  IF NULLIF(s->>'id', '') IS NULL OR NULLIF(s->>'bill_number', '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_SALE: id and bill number are required' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO existing_id FROM public.sales
   WHERE id = (s->>'id')::uuid
      OR (NULLIF(s->>'client_transaction_id','') IS NOT NULL
          AND client_transaction_id = s->>'client_transaction_id')
   LIMIT 1;
  IF existing_id IS NOT NULL AND existing_id <> (s->>'id')::uuid THEN
    RAISE EXCEPTION 'DUPLICATE_TRANSACTION: attempt already belongs to sale %', existing_id
      USING ERRCODE = '23505';
  END IF;

  -- A sale and its tender rows both reference the attached member. Upsert the
  -- parent first so a member created on this device can be used immediately.
  IF _member IS NOT NULL AND NULLIF(_member->>'id','') IS NOT NULL THEN
    INSERT INTO public.members (
      id, member_code, full_name, phone, email, address, date_of_birth,
      tier_id, loyalty_points, total_spent, updated_at
    ) VALUES (
      (_member->>'id')::uuid, _member->>'member_code', _member->>'full_name',
      COALESCE(_member->>'phone',''), NULLIF(_member->>'email',''),
      NULLIF(_member->>'address',''), NULLIF(_member->>'date_of_birth','')::date,
      NULLIF(_member->>'tier_id','')::uuid, COALESCE((_member->>'loyalty_points')::numeric,0),
      COALESCE((_member->>'total_spent')::numeric,0), now()
    ) ON CONFLICT (id) DO UPDATE SET
      member_code = EXCLUDED.member_code, full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone, email = EXCLUDED.email, address = EXCLUDED.address,
      date_of_birth = EXCLUDED.date_of_birth, tier_id = EXCLUDED.tier_id,
      loyalty_points = EXCLUDED.loyalty_points, total_spent = EXCLUDED.total_spent,
      row_version = members.row_version,
      updated_at = now();
  END IF;

  IF existing_id IS NULL THEN
    INSERT INTO public.sales (
    id, bill_number, member_id, store_id, shift_id, cashier_name,
    subtotal_amount, total_amount, discount_amount, tax_amount, payment_type,
    payments, points_earned, points_redeemed, is_exchange, original_bill_number,
    exchange_credit, paid_amount, change_amount, is_refunded, coupon_code,
    coupon_promo_id, coupon_scope, coupon_discount, client_transaction_id,
    store_name_snapshot, store_address_snapshot, rounding_adjustment,
    rounding_label, authorization_request_id, authorized_by, authorized_at,
    created_at
  ) VALUES (
    (s->>'id')::uuid, s->>'bill_number', NULLIF(s->>'member_id','')::uuid,
    NULLIF(s->>'store_id',''), NULLIF(s->>'shift_id',''), NULLIF(s->>'cashier_name',''),
    COALESCE((s->>'subtotal_amount')::numeric,0), COALESCE((s->>'total_amount')::numeric,0),
    COALESCE((s->>'discount_amount')::numeric,0), COALESCE((s->>'tax_amount')::numeric,0),
    COALESCE(NULLIF(s->>'payment_type',''),'cash'), COALESCE(s->'payments','[]'::jsonb),
    COALESCE((s->>'points_earned')::numeric,0), COALESCE((s->>'points_redeemed')::numeric,0),
    COALESCE((s->>'is_exchange')::boolean,false), NULLIF(s->>'original_bill_number',''),
    COALESCE((s->>'exchange_credit')::numeric,0), COALESCE((s->>'paid_amount')::numeric,0),
    COALESCE((s->>'change_amount')::numeric,0), COALESCE((s->>'is_refunded')::boolean,false),
    NULLIF(s->>'coupon_code',''), NULLIF(s->>'coupon_promo_id',''), NULLIF(s->>'coupon_scope',''),
    COALESCE((s->>'coupon_discount')::numeric,0), NULLIF(s->>'client_transaction_id',''),
    NULLIF(s->>'store_name_snapshot',''), NULLIF(s->>'store_address_snapshot',''),
    COALESCE((s->>'rounding_adjustment')::numeric,0), NULLIF(s->>'rounding_label',''),
    NULLIF(s->>'authorization_request_id','')::uuid, NULLIF(s->>'authorized_by',''),
    NULLIF(s->>'authorized_at','')::timestamptz, COALESCE(NULLIF(s->>'created_at','')::timestamptz,now())
    ) ON CONFLICT (id) DO NOTHING;
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(_items,'[]'::jsonb)) LOOP
    INSERT INTO public.sale_items (
      id, sale_id, product_id, product_name, variant_code, unit_price, unit_cost, quantity,
      discount_percent, discount_amount, tax_rate, is_return, is_foc,
      promo_id, coupon_code, coupon_discount, created_at
    ) VALUES (
      (entry->>'id')::uuid, (s->>'id')::uuid, NULLIF(entry->>'product_id','')::uuid,
      entry->>'product_name', NULLIF(entry->>'variant_code',''),
      COALESCE((entry->>'unit_price')::numeric,0),
      COALESCE((entry->>'unit_cost')::numeric,0), COALESCE((entry->>'quantity')::integer,1),
      COALESCE((entry->>'discount_percent')::numeric,0), COALESCE((entry->>'discount_amount')::numeric,0),
      COALESCE((entry->>'tax_rate')::numeric,0), COALESCE((entry->>'is_return')::boolean,false),
      COALESCE((entry->>'is_foc')::boolean,false), NULLIF(entry->>'promo_id',''),
      NULLIF(entry->>'coupon_code',''), COALESCE((entry->>'coupon_discount')::numeric,0), now()
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(_payments,'[]'::jsonb)) LOOP
    INSERT INTO public.payment_transactions (
      id, client_transaction_id, source_type, sale_id, booking_id, member_id, store_id, shift_id,
      terminal_id, amount, method, kind, reference, cashier_id, cashier_name,
      note, paid_at, created_at, status, metadata
    ) VALUES (
      (entry->>'id')::uuid, NULLIF(entry->>'client_transaction_id',''),
      COALESCE(NULLIF(entry->>'source_type',''),'sale'),
      (s->>'id')::uuid, NULL, NULLIF(entry->>'member_id','')::uuid,
      NULLIF(s->>'store_id',''), NULLIF(entry->>'shift_id',''),
      NULLIF(entry->>'terminal_id',''), COALESCE((entry->>'amount')::numeric,0),
      COALESCE(NULLIF(entry->>'method',''),'cash'), COALESCE(NULLIF(entry->>'kind',''),'payment'),
      NULLIF(entry->>'reference',''), NULLIF(entry->>'cashier_id',''), NULLIF(entry->>'cashier_name',''),
      COALESCE(entry->>'note',''), COALESCE(NULLIF(entry->>'paid_at','')::timestamptz,now()),
      COALESCE(NULLIF(entry->>'created_at','')::timestamptz,now()),
      COALESCE(NULLIF(entry->>'status',''),'completed'), COALESCE(entry->'metadata','{}'::jsonb)
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR entry IN SELECT value FROM jsonb_array_elements(COALESCE(_movements,'[]'::jsonb)) LOOP
    INSERT INTO public.item_activity_logs (
      id, product_id, product_name, sku, barcode, store_id, terminal_id,
      activity_type, reference, quantity_delta, stock_before, stock_after,
      unit_cost, staff_id, staff_name, role, note, created_at
    ) VALUES (
      (entry->>'id')::uuid, NULLIF(entry->>'product_id','')::uuid, NULLIF(entry->>'product_name',''),
      NULLIF(entry->>'sku',''), NULLIF(entry->>'barcode',''), NULLIF(s->>'store_id',''),
      NULLIF(entry->>'terminal_id',''), entry->>'activity_type', NULLIF(entry->>'reference',''),
      COALESCE((entry->>'quantity_delta')::integer,0), NULLIF(entry->>'stock_before','')::integer,
      NULLIF(entry->>'stock_after','')::integer, COALESCE((entry->>'unit_cost')::numeric,0),
      NULLIF(entry->>'staff_id',''), NULLIF(entry->>'staff_name',''), NULLIF(entry->>'role',''),
      COALESCE(entry->>'note',''), COALESCE(NULLIF(entry->>'created_at','')::timestamptz,now())
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR movement_result IN
    SELECT * FROM public.stock_apply_deltas(
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'movement_id', movement_entry.value->>'id',
        'product_id', movement_entry.value->>'product_id',
        'store_id', s->>'store_id',
        'delta', movement_entry.value->>'quantity_delta'
      )), '[]'::jsonb)
       FROM jsonb_array_elements(COALESCE(_movements,'[]'::jsonb)) AS movement_entry(value))
    )
  LOOP
    IF movement_result.status = 'refused' THEN
      RAISE EXCEPTION 'STOCK_REFUSED: %', COALESCE(movement_result.reason,'failed')
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF NULLIF(_exchange_bill,'') IS NOT NULL THEN
    UPDATE public.sales SET exchanged_to_bill_number = s->>'bill_number'
     WHERE bill_number = _exchange_bill AND COALESCE(store_id,'') = COALESCE(s->>'store_id','');
  END IF;

  RETURN jsonb_build_object('id', s->>'id', 'client_transaction_id', s->>'client_transaction_id');
END;
$$;

REVOKE ALL ON FUNCTION public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pos_admin_correct_closed_shift(
  p_shift uuid, p_cash numeric, p_card numeric, p_digital numeric,
  p_reason text, p_actor_id text, p_actor_name text, p_terminal text, p_client_key text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v public.shifts%ROWTYPE; e record; v_count uuid; v_rec uuid;
  v_existing_cash numeric; v_existing_card numeric; v_existing_digital numeric;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before jsonb; v_after jsonb;
  v_var_cash numeric; v_var_card numeric; v_var_digital numeric; v_total numeric; v_status text;
BEGIN
  IF char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'A correction reason of at least 3 characters is required.';
  END IF;
  IF nullif(btrim(coalesce(p_client_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A client correction key is required.';
  END IF;
  IF p_cash IS NULL OR p_cash < 0 OR (p_card IS NOT NULL AND p_card < 0)
     OR (p_digital IS NOT NULL AND p_digital < 0) THEN
    RAISE EXCEPTION 'Counted tender amounts cannot be negative.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_key, 0));
  SELECT * INTO v FROM public.shifts WHERE id = p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That shift no longer exists.'; END IF;

  SELECT shift_id, counted_cash, counted_card, counted_digital
    INTO v_count, v_existing_cash, v_existing_card, v_existing_digital
    FROM public.shift_cash_counts
   WHERE client_key = p_client_key LIMIT 1;
  IF FOUND THEN
    IF v_count <> p_shift THEN
      RAISE EXCEPTION 'That correction key was already used for another shift.';
    END IF;
    IF v_existing_cash IS DISTINCT FROM p_cash
       OR v_existing_card IS DISTINCT FROM p_card
       OR v_existing_digital IS DISTINCT FROM p_digital THEN
      RAISE EXCEPTION 'That correction key was already used with different counted amounts.';
    END IF;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'shift_id', v_count);
  END IF;

  IF v.status IS DISTINCT FROM 'CLOSED' OR coalesce(v.state, 'CLOSED') <> 'CLOSED' THEN
    RAISE EXCEPTION 'Only a closed shift can be corrected.';
  END IF;
  SELECT * INTO e FROM public.shift_expected_totals(p_shift);
  v_var_cash := round(p_cash - e.expected_cash, 2);
  v_var_card := CASE WHEN p_card IS NULL THEN NULL ELSE round(p_card - e.expected_card, 2) END;
  v_var_digital := CASE WHEN p_digital IS NULL THEN NULL ELSE round(p_digital - e.expected_digital, 2) END;
  v_total := round(v_var_cash + coalesce(v_var_card, 0) + coalesce(v_var_digital, 0), 2);
  v_status := CASE WHEN abs(v_total) <= 0.005 THEN 'NO_VARIANCE'
                   WHEN v_total > 0 THEN 'OVER' ELSE 'SHORT' END;
  v_before := jsonb_build_object(
    'counted_cash', v.counted_cash, 'counted_card', v.counted_card,
    'counted_digital', v.counted_digital, 'expected_cash', v.expected_cash,
    'expected_card', v.expected_card, 'expected_digital', v.expected_digital,
    'variance_cash', v.variance_cash, 'variance_card', v.variance_card,
    'variance_digital', v.variance_digital, 'variance_total', v.variance_total,
    'variance_status', v.variance_status
  );

  INSERT INTO public.shift_cash_counts
    (shift_id, store_id, terminal_id, kind, counted_cash, counted_card, counted_digital,
     reason, counted_by_name, counted_by_staff_id, client_key)
  VALUES
    (p_shift, v.store_id, coalesce(p_terminal, v.terminal_id), 'RECOUNT', p_cash, p_card,
     p_digital, v_reason, nullif(p_actor_name, ''), nullif(p_actor_id, ''), p_client_key)
  RETURNING id INTO v_count;
  INSERT INTO public.shift_reconciliations
    (shift_id, store_id, count_id, expected_cash, expected_card, expected_digital,
     counted_cash, counted_card, counted_digital, variance_cash, variance_card,
     variance_digital, variance_total, variance_status)
  VALUES
    (p_shift, v.store_id, v_count, e.expected_cash, e.expected_card, e.expected_digital,
     p_cash, p_card, p_digital, v_var_cash, v_var_card, v_var_digital, v_total, v_status)
  RETURNING id INTO v_rec;

  PERFORM set_config('pos.shift_fn', 'on', true);
  UPDATE public.shifts SET
    counted_cash = p_cash, final_counted_cash = p_cash, closing_float = p_cash,
    counted_card = p_card, counted_digital = p_digital,
    expected_cash = e.expected_cash, expected_card = e.expected_card,
    expected_digital = e.expected_digital, variance_cash = v_var_cash,
    variance_card = v_var_card, variance_digital = v_var_digital,
    variance_total = v_total, variance_status = v_status,
    row_version = coalesce(row_version, 0) + 1, updated_at = now()
  WHERE id = p_shift;
  PERFORM set_config('pos.shift_fn', '', true);

  v_after := jsonb_build_object(
    'counted_cash', p_cash, 'counted_card', p_card, 'counted_digital', p_digital,
    'expected_cash', e.expected_cash, 'expected_card', e.expected_card,
    'expected_digital', e.expected_digital, 'variance_cash', v_var_cash,
    'variance_card', v_var_card, 'variance_digital', v_var_digital,
    'variance_total', v_total, 'variance_status', v_status
  );
  INSERT INTO public.record_edits
    (record_type, record_id, reference, store_id, terminal_id, action_key, edited_by,
     edited_by_name, authorized_by, authorized_by_name, mode_used, before_value,
     after_value, note)
  VALUES
    ('shift', p_shift::text, p_shift::text, v.store_id, coalesce(p_terminal, v.terminal_id),
     'SHIFT_CLOSE_CORRECTED', nullif(p_actor_id, ''), nullif(p_actor_name, ''),
     nullif(p_actor_id, ''), nullif(p_actor_name, ''), 'admin', v_before, v_after, v_reason);
  INSERT INTO public.activity_events
    (severity, title, message, actor_id, actor_name, actor_role, terminal_id, store_id,
     entity_type, entity_id, amount, meta, client_event_id)
  VALUES
    ('warning', 'Closed shift corrected', v_reason, nullif(p_actor_id, ''),
     nullif(p_actor_name, ''), 'admin', coalesce(p_terminal, v.terminal_id), v.store_id,
     'shift', p_shift::text, v_total,
     jsonb_build_object('before', v_before, 'after', v_after, 'reconciliation_id', v_rec),
     'shift-correction:' || p_client_key)
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'shift_id', p_shift,
                            'variance_total', v_total, 'variance_status', v_status);
END $fn$;

REVOKE ALL ON FUNCTION public.pos_admin_correct_closed_shift(
  uuid, numeric, numeric, numeric, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_admin_correct_closed_shift(
  uuid, numeric, numeric, numeric, text, text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_product_price_permissions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  lifecycle_enabled boolean := false;
  has_stock boolean := false;
  automatic_lifecycle_change boolean := false;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NOT public.has_perm('can_add_new_product') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (COALESCE(NEW.selling_price,0) <> COALESCE(OLD.selling_price,0)
        OR COALESCE(NEW.cost_price,0) <> COALESCE(OLD.cost_price,0)
        OR COALESCE(NEW.ecom_price,-1) IS DISTINCT FROM COALESCE(OLD.ecom_price,-1))
       AND NOT public.has_perm('can_edit_product_price') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_PRICE';
    END IF;
    IF (NEW.name IS DISTINCT FROM OLD.name OR NEW.sku IS DISTINCT FROM OLD.sku
        OR NEW.barcode IS DISTINCT FROM OLD.barcode OR NEW.category IS DISTINCT FROM OLD.category
        OR NEW.sub_category IS DISTINCT FROM OLD.sub_category
        OR NEW.product_group IS DISTINCT FROM OLD.product_group OR NEW.brand IS DISTINCT FROM OLD.brand
        OR NEW.unit IS DISTINCT FROM OLD.unit OR NEW.packs IS DISTINCT FROM OLD.packs
        OR NEW.reorder_level IS DISTINCT FROM OLD.reorder_level OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate)
       AND NOT public.has_perm('can_edit_product_details') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT_DETAILS';
    END IF;
    IF (NEW.barcode_aliases IS DISTINCT FROM OLD.barcode_aliases
        OR NEW.barcode_variants IS DISTINCT FROM OLD.barcode_variants)
       AND NOT public.has_perm('can_link_product_barcode') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT_BARCODE';
    END IF;
    IF NEW.ecom_visible IS DISTINCT FROM OLD.ecom_visible
       AND NOT public.has_perm('can_publish_product') THEN
      RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT_PUBLISH';
    END IF;
    IF NEW.is_archived IS DISTINCT FROM OLD.is_archived THEN
      SELECT COALESCE((integration_settings ->> 'autoArchiveZeroStock')::boolean, true)
        INTO lifecycle_enabled
        FROM public.pos_settings
       WHERE id = 1;
      SELECT EXISTS (
        SELECT 1
          FROM jsonb_each_text(COALESCE(NEW.stock_by_store, '{}'::jsonb))
         WHERE value ~ '^-?[0-9]+([.][0-9]+)?$'
           AND value::numeric > 0
      ) INTO has_stock;
      automatic_lifecycle_change := lifecycle_enabled
        AND (NEW.stock_by_store IS DISTINCT FROM OLD.stock_by_store OR pg_trigger_depth() > 1)
        AND NEW.is_archived = NOT has_stock;

      IF NOT automatic_lifecycle_change THEN
        IF NEW.is_archived AND NOT public.has_perm('can_archive_product') THEN
          RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT_ARCHIVE';
        END IF;
        IF NOT NEW.is_archived AND NOT public.has_perm('can_restore_product') THEN
          RAISE EXCEPTION 'PERMISSION_DENIED_PRODUCT_RESTORE';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_product_price_permissions() FROM PUBLIC;
DROP POLICY IF EXISTS "Staff can delete" ON public.products;

-- Optional catalogue lifecycle: zero company-wide stock retires the product,
-- and the next positive receipt restores it without a manual archive edit.
CREATE OR REPLACE FUNCTION public.apply_zero_stock_catalog_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  enabled boolean := false;
  had_stock boolean := false;
  has_stock boolean := false;
BEGIN
  SELECT lower(COALESCE(integration_settings ->> 'autoArchiveZeroStock', 'true')) = 'true'
    INTO enabled FROM public.pos_settings WHERE id = 1;
  IF NOT enabled THEN RETURN NEW; END IF;
  -- Treat malformed legacy stock payloads as unknown, not zero stock. This
  -- prevents a bad JSON shape from automatically archiving a product.
  IF jsonb_typeof(NEW.stock_by_store) IS DISTINCT FROM 'object' THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_each_text(COALESCE(NEW.stock_by_store, '{}'::jsonb))
     WHERE value ~ '^-?[0-9]+([.][0-9]+)?$' AND value::numeric > 0
  ) INTO has_stock;
  IF TG_OP = 'INSERT' AND NOT has_stock THEN
    NEW.is_archived := true;
    NEW.archived_at := COALESCE(NEW.archived_at, now());
  ELSIF TG_OP = 'INSERT' AND has_stock THEN
    NEW.is_archived := COALESCE(NEW.is_archived, false);
    NEW.archived_at := CASE
      WHEN NEW.is_archived THEN COALESCE(NEW.archived_at, now())
      ELSE NULL
    END;
  ELSE
    IF jsonb_typeof(OLD.stock_by_store) = 'object' THEN
      SELECT EXISTS (
        SELECT 1 FROM jsonb_each_text(OLD.stock_by_store)
         WHERE value ~ '^-?[0-9]+([.][0-9]+)?$' AND value::numeric > 0
      ) INTO had_stock;
    ELSE
      had_stock := true;
    END IF;
    IF NOT has_stock THEN
      NEW.is_archived := true;
      NEW.archived_at := COALESCE(NEW.archived_at, now());
    ELSIF NOT had_stock AND has_stock THEN
      NEW.is_archived := false;
      NEW.archived_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_product_price_permissions() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
