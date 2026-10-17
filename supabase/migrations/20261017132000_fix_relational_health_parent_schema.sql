-- Preserve existing privileges; qualify referenced tables by their actual schema.
CREATE OR REPLACE FUNCTION public.operational_relational_health() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tables text[] := ARRAY[
    'sales','sale_items','bookings','booking_payments','payment_transactions',
    'products','product_barcodes','product_categories','members','membership_tiers',
    'purchase_orders','purchase_order_items','stock_transfers','stock_transfer_items',
    'promotions','coupon_campaigns','issued_vouchers','stock_adjustments','item_activity_logs'
  ];
  _t text;
  _fk record;
  _orphans bigint;
  _rows bigint;
  _links jsonb;
  _out jsonb := '[]'::jsonb;
BEGIN
  FOREACH _t IN ARRAY _tables LOOP
    IF to_regclass('public.' || _t) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I', _t) INTO _rows;
    _links := '[]'::jsonb;

    FOR _fk IN
      SELECT c.conname,
             a.attname   AS child_column,
             pt.relname  AS parent_table,
             pn.nspname AS parent_schema,
             pa.attname  AS parent_column
      FROM pg_constraint c
      JOIN pg_class ct ON ct.oid = c.conrelid
      JOIN pg_class pt ON pt.oid = c.confrelid
      JOIN pg_namespace pn ON pn.oid = pt.relnamespace
      JOIN unnest(c.conkey)  WITH ORDINALITY AS ck(attnum, ord) ON true
      JOIN unnest(c.confkey) WITH ORDINALITY AS pk(attnum, ord) ON pk.ord = ck.ord
      JOIN pg_attribute a  ON a.attrelid  = c.conrelid  AND a.attnum  = ck.attnum
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = pk.attnum
      WHERE c.contype = 'f'
        AND ct.relnamespace = 'public'::regnamespace
        AND ct.relname = _t
    LOOP
      EXECUTE format(
        'SELECT count(*) FROM public.%I ch WHERE ch.%I IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM %I.%I pr WHERE pr.%I = ch.%I)',
        _t, _fk.child_column, _fk.parent_schema, _fk.parent_table, _fk.parent_column, _fk.child_column
      ) INTO _orphans;

      _links := _links || jsonb_build_object(
        'constraint', _fk.conname,
        'column', _fk.child_column,
        'parent_table', _fk.parent_table,
        'parent_column', _fk.parent_column,
        'orphans', _orphans
      );
    END LOOP;

    _out := _out || jsonb_build_object(
      'table', _t,
      'rows', _rows,
      'links', _links
    );
  END LOOP;

  RETURN jsonb_build_object('at', now(), 'tables', _out);
END;
$$;
