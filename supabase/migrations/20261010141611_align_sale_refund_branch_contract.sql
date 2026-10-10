-- Align the existing refund routine with the web and terminal RPC payload.
-- Keep one signature; four-argument callers remain valid through the default.
BEGIN;
DROP FUNCTION IF EXISTS public.sale_refund(uuid, jsonb, text, text);
CREATE OR REPLACE FUNCTION public.sale_refund(
  _sale_id uuid,
  _lines jsonb DEFAULT NULL,
  _client_refund_id text DEFAULT NULL,
  _reason text DEFAULT NULL,
  _branch_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  _sale public.sales%ROWTYPE;
  _key text := coalesce(nullif(btrim(coalesce(_client_refund_id, '')), ''), _sale_id::text);
  _item record;
  _want integer;
  _remaining integer;
  _movement uuid;
  _stock integer;
  _results jsonb := '[]'::jsonb;
  _outstanding integer;
  _direct boolean := auth.uid() IS NOT NULL;
BEGIN
  -- A direct caller must be staff with the refund permission. A call with no
  -- signed-in user can only come from the trusted server relay, which has
  -- already proved the caller, their branch and their permission.
  IF _direct THEN
    IF NOT public.is_staff_now() THEN
      RAISE EXCEPTION 'Sign in with a staff account to process a refund';
    END IF;
    IF NOT public.has_perm('can_process_refund') THEN
      RAISE EXCEPTION 'You are not allowed to process refunds';
    END IF;
  END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown bill';
  END IF;
  IF nullif(btrim(_branch_id), '') IS NOT NULL AND _branch_id <> _sale.store_id THEN
    RAISE EXCEPTION 'The refund must belong to the specified branch';
  END IF;
  IF _direct AND NOT public.user_has_store_access(_sale.store_id) THEN
    RAISE EXCEPTION 'You can only refund bills from your own branch';
  END IF;

  PERFORM set_config('pos.refunding', 'on', true);

  FOR _item IN
    SELECT si.id, si.product_id, si.quantity, si.refunded_qty
      FROM public.sale_items si
     WHERE si.sale_id = _sale_id
     ORDER BY si.id
     FOR UPDATE
  LOOP
    IF _lines IS NULL OR jsonb_array_length(_lines) = 0 THEN
      _want := GREATEST(_item.quantity, 0) - _item.refunded_qty;
    ELSE
      SELECT COALESCE(SUM(GREATEST((l ->> 'qty')::int, 0)), 0) INTO _want
        FROM jsonb_array_elements(_lines) l
       WHERE (l ->> 'item_id') = _item.id::text
          OR ((l ->> 'item_id') IS NULL AND (l ->> 'product_id') = _item.product_id::text);
    END IF;

    CONTINUE WHEN coalesce(_want, 0) <= 0;

    _remaining := GREATEST(_item.quantity, 0) - _item.refunded_qty;
    IF _want > _remaining THEN
      RAISE EXCEPTION 'Cannot return % of "%": only % left to return',
        _want, _item.product_id, _remaining;
    END IF;

    UPDATE public.sale_items
       SET refunded_qty = refunded_qty + _want
     WHERE id = _item.id;

    _movement := md5(_key || ':' || _item.id::text)::uuid;
    _stock := public.stock_apply_delta(_movement, _item.product_id, _sale.store_id, _want);
    _results := _results || jsonb_build_object(
      'item_id', _item.id,
      'product_id', _item.product_id,
      'qty', _want,
      'stock', _stock
    );
  END LOOP;

  SELECT COALESCE(SUM(GREATEST(si.quantity, 0) - si.refunded_qty), 0) INTO _outstanding
    FROM public.sale_items si WHERE si.sale_id = _sale_id;

  IF _outstanding = 0 THEN
    UPDATE public.sales
       SET is_refunded = true, updated_by = coalesce(auth.uid()::text, updated_by)
     WHERE id = _sale_id AND coalesce(is_refunded, false) = false;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (action, entity_type, entity_id, user_id, details)
    VALUES ('sale_refund', 'sale', _sale_id::text, auth.uid(),
            jsonb_build_object('reason', _reason, 'lines', _results, 'refund_id', _key));
  EXCEPTION WHEN others THEN
    NULL;
  END;

  PERFORM set_config('pos.refunding', 'off', true);

  RETURN jsonb_build_object(
    'sale_id', _sale_id,
    'fully_refunded', _outstanding = 0,
    'lines', _results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sale_refund(uuid, jsonb, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sale_refund(uuid, jsonb, text, text, text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
